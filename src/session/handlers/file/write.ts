import { Buffer } from "node:buffer"

import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { ValidFileOptions } from "#session/handlers/file.ts"
import type { HostFileDetails } from "#session/handlers/file/host-file-details.ts"
import type { ResolvedFileContent } from "#session/handlers/file/resolved-content.ts"
import type { HostFileAttributeDetails } from "#session/handlers/shared/filesystem/attributes.ts"
import {
  PRIVATE_FILE_MODE,
  PUBLIC_FILE_MODE,
  parseFileMode,
  toOctalMode,
} from "#session/handlers/shared/filesystem/mode.ts"
import {
  REMOVE_TEMP_DIRECTORY_LINES,
  TEMP_PATH_ARG,
  buildChownLines,
  buildTempDirectoryLines,
  toWriteScriptPaths,
} from "#session/handlers/shared/filesystem/write-script.ts"
import { createCommandExitError } from "#session/shell.ts"
import type { StepContext } from "#session/step.ts"

const HEREDOC_DELIMITER = "__TSINFRA_EOF__"
// Stand in for the content in the record, because it may be a secret and it can be large.
const RECORDED_CONTENT = "<content as base64>"
// Mark a failed validation on stdout, which the write script doesn't otherwise use, so it can't be mistaken for output.
const VALIDATE_FAILED_MARKER = "validate=failed"

/** What a write puts in place: the content, and the command that checks it first, when there is one. */
export interface FileWrite {
  resolvedContent: ResolvedFileContent
  validateCommand: string | undefined
}

/** Returns the mode to write: the one given, then the file's own, then the default for a new file. */
const getModeArg = (attributes: HostFileAttributeDetails | undefined, options: ValidFileOptions): string => {
  const { mode, secret } = options

  const defaultMode = secret ? PRIVATE_FILE_MODE : PUBLIC_FILE_MODE
  const bits = mode === undefined ? (attributes?.mode ?? parseFileMode(defaultMode)) : parseFileMode(mode)
  return toOctalMode(bits)
}

/**
 * Returns a function that puts the given text in the heredoc of the script that writes the file (see
 * `docs/transport.md`). The real script and the recorded one differ only in that text.
 */
const createWriteScript = (
  hostFileDetails: HostFileDetails,
  validateCommand: string | undefined,
  options: ValidFileOptions,
) => {
  const { path } = hostFileDetails
  const isNewFile = hostFileDetails.kind === "new"
  const attributes = isNewFile ? undefined : hostFileDetails.attributes

  const writeScriptPaths = toWriteScriptPaths(path)
  const { quotedPath, quotedDirectory } = writeScriptPaths
  const modeArg = getModeArg(attributes, options)

  const chownLines = buildChownLines(attributes, TEMP_PATH_ARG, options)
  // Ignore a failure, because `chcon` can exist on a system with SELinux off, and then it fails.
  const chconLines = isNewFile
    ? []
    : [`command -v chcon >/dev/null 2>&1 && chcon --reference=${quotedPath} ${TEMP_PATH_ARG} 2>/dev/null || true`]
  // Run the command in a subshell, so an `exit` in it ends only the command.
  // Send its stdout to stderr, so the script's stdout holds only the marker.
  // Exit with the command's own code, so the error shows it.
  const validateLines =
    validateCommand === undefined
      ? []
      : [`( ${validateCommand}`, `) >&2 || { status=$?; echo ${VALIDATE_FAILED_MARKER}; exit "$status"; }`]
  // Skip an existing file, because `restorecon` could reset a label that `chcon` just kept.
  const restoreconLines = isNewFile
    ? [`command -v restorecon >/dev/null 2>&1 && restorecon ${quotedPath} 2>/dev/null || true`]
    : []

  const linesBeforeContent = [
    "set -eu",
    `mkdir -p ${quotedDirectory}`,
    "umask 077",
    ...buildTempDirectoryLines(writeScriptPaths),
    `base64 -d > ${TEMP_PATH_ARG} <<'${HEREDOC_DELIMITER}'`,
  ]
  const linesAfterContent = [
    HEREDOC_DELIMITER,
    ...chownLines,
    `chmod ${modeArg} ${TEMP_PATH_ARG}`,
    ...chconLines,
    ...validateLines,
    `mv -f ${TEMP_PATH_ARG} ${quotedPath}`,
    ...REMOVE_TEMP_DIRECTORY_LINES,
    ...restoreconLines,
  ]

  return (encodedContent: string) => [...linesBeforeContent, encodedContent, ...linesAfterContent].join("\n")
}

/**
 * Writes the file on the host with one script, so the path is only ever the old file or the complete new one. Uses
 * `inspect`, because a failed validation is told apart from a failed write by the script's stdout, which `exec` drops
 * on a failure.
 */
export const writeFile = async (
  ctx: StepContext,
  hostFileDetails: HostFileDetails,
  fileWrite: FileWrite,
  options: ValidFileOptions,
): Promise<Result> => {
  const { shell } = ctx
  const { path } = hostFileDetails
  const { resolvedContent, validateCommand } = fileWrite

  const withContent = createWriteScript(hostFileDetails, validateCommand, options)
  const encodedContent = Buffer.from(resolvedContent.bytes).toString("base64")
  const writeScript = withContent(encodedContent)

  const writeScriptOutput = await shell.inspect(writeScript, {
    label: "file write",
    recordedCmd: withContent(RECORDED_CONTENT),
  })
  if (isErr(writeScriptOutput)) return err(`failed to write '${path}'`, writeScriptOutput)

  const { stdout, exitCode } = writeScriptOutput
  if (exitCode === 0) return

  const exitError = createCommandExitError(writeScriptOutput)
  const isValidateFailure = stdout.trim() === VALIDATE_FAILED_MARKER
  const cause = isValidateFailure
    ? err(`the validate command '${validateCommand}' ${exitError.message}`, undefined)
    : exitError

  return err(`failed to write '${path}'`, cause)
}
