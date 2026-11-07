import nodePath from "node:path"

import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { ValidFileOptions } from "#session/handlers/file.ts"
import type { HostFileAttributeDetails, HostFileDetails } from "#session/handlers/file/host-file-details.ts"
import { PRIVATE_FILE_MODE, PUBLIC_FILE_MODE, toModeBits, toOctalMode } from "#session/handlers/file/mode.ts"
import type { ResolvedFileContent } from "#session/handlers/file/resolved-content.ts"
import { quoteShellArg } from "#session/shell.ts"
import type { StepContext } from "#session/step.ts"

const HEREDOC_DELIMITER = "__TSINFRA_EOF__"
// Stand in for the content in the record, because it may be a secret and it can be large.
const RECORDED_CONTENT = "<content as base64>"
// Wrap the base64 at 76 columns, like GNU `base64` does, because one huge line isn't checked on every shell.
const BASE64_LINE = /.{1,76}/gv

const encodeContent = (bytes: Uint8Array): string =>
  (Buffer.from(bytes).toString("base64").match(BASE64_LINE) ?? []).join("\n")

/** Returns the mode to write: the one given, then the file's own, then the default for a new file. */
const getModeArg = (attributes: HostFileAttributeDetails | undefined, options: ValidFileOptions): string => {
  const { mode, secret } = options

  const defaultMode = secret ? PRIVATE_FILE_MODE : PUBLIC_FILE_MODE
  const bits = mode === undefined ? (attributes?.mode ?? toModeBits(defaultMode)) : toModeBits(mode)
  return toOctalMode(bits)
}

/** Returns `chown`'s `user:group`, each the one given and then the file's own, or nothing for a new file with neither. */
const getOwnerArg = (
  attributes: HostFileAttributeDetails | undefined,
  options: ValidFileOptions,
): string | undefined => {
  const user = options.user ?? attributes?.uid
  const group = options.group ?? attributes?.gid
  if (user === undefined && group === undefined) return undefined

  return `${user ?? ""}${group === undefined ? "" : `:${group}`}`
}

/**
 * Returns a function that puts the given text in the heredoc of the script that writes the file (see
 * `docs/transport.md`). The real script and the recorded one differ only in that text.
 */
const createWriteScript = (
  path: string,
  attributes: HostFileAttributeDetails | undefined,
  options: ValidFileOptions,
) => {
  const directory = nodePath.posix.dirname(path)
  const tempTemplate = nodePath.posix.join(directory, `.${nodePath.posix.basename(path)}.tsinfra.XXXXXX`)

  const quotedPath = quoteShellArg(path)
  const quotedDirectory = quoteShellArg(directory)
  const quotedTempTemplate = quoteShellArg(tempTemplate)
  const modeArg = getModeArg(attributes, options)
  const ownerArg = getOwnerArg(attributes, options)
  const isNewFile = attributes === undefined

  // Keep `--` here, because a user or group name comes from the script.
  const chownLines = ownerArg === undefined ? [] : [`chown -- ${quoteShellArg(ownerArg)} "$tmp"`]
  // Ignore a failure, because `chcon` can exist on a system with SELinux off, and then it fails.
  const chconLines = isNewFile
    ? []
    : [`command -v chcon >/dev/null 2>&1 && chcon --reference=${quotedPath} "$tmp" 2>/dev/null || true`]
  // Skip an existing file, because `restorecon` could reset a label that `chcon` just kept.
  const restoreconLines = isNewFile
    ? [`command -v restorecon >/dev/null 2>&1 && restorecon ${quotedPath} 2>/dev/null || true`]
    : []

  const linesBeforeContent = [
    "set -eu",
    `mkdir -p ${quotedDirectory}`,
    "umask 077",
    `tmp=$(mktemp ${quotedTempTemplate})`,
    `trap 'rm -f "$tmp"' EXIT`,
    `base64 -d > "$tmp" <<'${HEREDOC_DELIMITER}'`,
  ]
  const linesAfterContent = [
    HEREDOC_DELIMITER,
    ...chownLines,
    `chmod ${modeArg} "$tmp"`,
    ...chconLines,
    `mv -f "$tmp" ${quotedPath}`,
    "trap - EXIT",
    ...restoreconLines,
  ]

  return (encodedContent: string) => [...linesBeforeContent, encodedContent, ...linesAfterContent].join("\n")
}

/** Writes the file on the host with one script, so the path is only ever the old file or the complete new one. */
export const writeFile = async (
  ctx: StepContext,
  hostFileDetails: HostFileDetails,
  resolvedContent: ResolvedFileContent,
  options: ValidFileOptions,
): Promise<Result> => {
  const { shell } = ctx
  const { path } = hostFileDetails
  const attributes = hostFileDetails.kind === "existing" ? hostFileDetails.attributes : undefined

  const withContent = createWriteScript(path, attributes, options)
  const script = withContent(encodeContent(resolvedContent.bytes))
  const output = await shell.exec(script, {
    label: "file write",
    recordedCmd: withContent(RECORDED_CONTENT),
  })
  if (isErr(output)) return err(`failed to write '${path}'`, output)
}
