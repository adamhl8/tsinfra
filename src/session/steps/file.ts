import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { HostState } from "#session/converge.ts"
import { converge } from "#session/converge.ts"
import { toAbsolutePath } from "#session/paths/home.ts"
import { quoteShellArg } from "#session/paths/quote.ts"
import type { Shell } from "#session/shell.ts"
import type { NeededSteps, StepContext, StepDetails } from "#session/step.ts"
import { needsSchema } from "#session/step.ts"
import type { AttributeChange, Bytes, FileContent } from "#session/steps/file/comparison.ts"
import { toBytes } from "#session/steps/file/comparison.ts"
import type { FileMode } from "#session/steps/file/mode.ts"
import { formatMode, OCTAL_MODE_PATTERN, SYMBOLIC_MODE_PATTERN, toModeBits } from "#session/steps/file/mode.ts"

export interface FileOptions {
  /** What the file should hold, computed on the control machine. */
  content: string | Uint8Array
  /**
   * The file's mode, in octal like `"644"`, symbolic like `"rw-r--r--"`, or a constant like `PUBLIC_FILE_MODE`. An
   * existing file keeps its own when this is left out.
   */
  mode?: FileMode
  /** The owner: a name is compared with the file owner's name, and a number with its uid. */
  owner?: string | number
  /** The group: a name is compared with the file group's name, and a number with its gid. */
  group?: string | number
  /** Never fetches or shows the old content, because it may hold a secret. */
  secret?: boolean
  /**
   * Earlier steps this step depends on. In `plan`, the step waits instead of checking when one of them would change or
   * is waiting.
   */
  needs?: NeededSteps
}

// Skip the diff when either side is above this size, because fetching and diffing a large file costs more than the diff tells.
const MAX_DIFF_BYTES = toBytes(100_000) // 100 kB
const SHA256_LENGTH = 64
const SHA256_PATTERN = /^[0-9a-f]{64}/v
const WHITESPACE = /\s+/v

/** What the check found at a path that is a regular file. */
interface RemoteFile {
  hash: string
  mode: number
  uid: number
  gid: number
  user: string
  group: string
  size: Bytes
}

type CheckFindings =
  | { kind: "absent" }
  | { kind: "link" }
  | { kind: "other" }
  | { kind: "unreadable" }
  | { kind: "file"; remoteFile: RemoteFile }

/**
 * Returns one command that says what is at `path`, and for a regular file, its sha256, mode, owner, and size. It tries
 * each common sha256 command, because POSIX has none, and feeds the file on stdin, because GNU `sha256sum` escapes odd
 * file names in its output. `stat -c` goes first, because GNU's `stat -f` prints filesystem information instead of
 * failing. BSD needs `%Mp%Lp` to keep setuid and setgid.
 */
const buildCheckCommand = (path: string) =>
  [
    `p=${quoteShellArg(path)}`,
    `if [ -L "$p" ]; then echo kind=link`,
    `elif [ ! -e "$p" ]; then echo kind=absent`,
    `elif [ ! -f "$p" ]; then echo kind=other`,
    `elif [ ! -r "$p" ]; then echo kind=unreadable`,
    "else",
    "  echo kind=file",
    `  { sha256sum < "$p" || shasum -a 256 < "$p" || sha256 < "$p"; } 2>/dev/null`,
    `  stat -c '%a %u %g %U %G %s' "$p" 2>/dev/null || stat -f '%Mp%Lp %u %g %Su %Sg %z' "$p"`,
    "fi",
  ].join("\n")

/** Parses the check command's output, which differs between GNU, busybox, and BSD only in ways this allows for. */
export const parseCheckOutput = (stdout: string): Result<CheckFindings> => {
  const [kindLine = "", hashLine = "", statLine = ""] = stdout.split("\n")
  const kind = kindLine.replace("kind=", "")

  if (kind === "absent" || kind === "link" || kind === "other" || kind === "unreadable") return { kind }
  if (kind !== "file") return err(`the file check printed '${kindLine}' instead of what it is`, undefined)

  // Read the first 64 hex characters, because GNU, busybox, and `shasum` print `<hash>  -`, and BSD prints the hash.
  const hash = SHA256_PATTERN.exec(hashLine)?.[0]
  if (hash?.length !== SHA256_LENGTH)
    return err("the file check found no sha256 command (sha256sum, shasum, or sha256) on the host", undefined)

  const [mode = "", uid = "", gid = "", user = "", group = "", size = ""] = statLine.trim().split(WHITESPACE)
  // Parse the mode as octal, because GNU prints `644` and BSD prints `0644`.
  const remoteFile = {
    hash,
    mode: Number.parseInt(mode, 8),
    uid: Number(uid),
    gid: Number(gid),
    user,
    group,
    size: toBytes(Number(size)),
  }
  if ([remoteFile.mode, remoteFile.uid, remoteFile.gid, remoteFile.size].some((value) => Number.isNaN(value)))
    return err(`the file check printed '${statLine}' instead of the file's mode, owner, and size`, undefined)

  return { kind: "file", remoteFile }
}

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true })

// Treat content with a NUL byte, or that isn't valid UTF-8, as binary, because a line diff of it would be noise.
const decodeText = (bytes: Uint8Array): string | undefined => {
  const text = attempt(() => TEXT_DECODER.decode(bytes))
  return isErr(text) || text.includes("\0") ? undefined : text
}

/** What the script wants the file to be, worked out once before the check runs. */
interface WantedFile {
  bytes: Uint8Array
  size: Bytes
  hash: string
  mode?: FileMode
  owner?: string | number
  group?: string | number
}

const toWantedFile = (options: FileOptions): WantedFile => {
  const { content, mode, owner, group } = options
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
  return {
    bytes,
    size: toBytes(bytes.length),
    hash,
    ...(mode === undefined ? {} : { mode }),
    ...(owner === undefined ? {} : { owner }),
    ...(group === undefined ? {} : { group }),
  }
}

/** Lists the given attributes whose value on the host differs, comparing a name with a name and a number with an id. */
const findAttributeChanges = (remoteFile: RemoteFile, wantedFile: WantedFile): AttributeChange[] => {
  const { mode, owner, group } = wantedFile
  const changes: AttributeChange[] = []

  // Compare only the permission bits, because the type bits aren't something a file step sets.
  const gotMode = remoteFile.mode % 0o1_0000
  const wantMode = mode === undefined ? undefined : toModeBits(mode)
  const isModeChanged = wantMode !== undefined && gotMode !== wantMode
  if (isModeChanged) changes.push({ name: "mode", got: formatMode(gotMode), want: formatMode(wantMode) })

  const gotOwner = typeof owner === "number" ? remoteFile.uid : remoteFile.user
  if (owner !== undefined && gotOwner !== owner)
    changes.push({ name: "owner", got: String(gotOwner), want: String(owner) })

  const gotGroup = typeof group === "number" ? remoteFile.gid : remoteFile.group
  if (group !== undefined && gotGroup !== group)
    changes.push({ name: "group", got: String(gotGroup), want: String(group) })

  return changes
}

interface ReadFileStateInput {
  shell: Shell
  path: string
  wantedFile: WantedFile
  secret: boolean
}

/** Works out how the content differs, fetching the old content only when the output can show a diff of it. */
const compareContent = async (input: ReadFileStateInput, remoteFile: RemoteFile): Promise<Result<FileContent>> => {
  const { shell, path, wantedFile, secret } = input
  const { bytes, size: wantSize, hash } = wantedFile
  const { size: gotSize } = remoteFile

  if (remoteFile.hash === hash) return { kind: "same" }
  if (secret) return { kind: "hidden", gotSize, wantSize }
  if (gotSize > MAX_DIFF_BYTES || wantSize > MAX_DIFF_BYTES) return { kind: "large", gotSize, wantSize }

  const want = decodeText(bytes)
  if (want === undefined) return { kind: "binary", gotSize, wantSize }

  const got = await shell.run(`cat -- ${quoteShellArg(path)}`)
  if (isErr(got)) return err(`failed to read '${path}' for its diff`, got)
  if (got.includes("\0") || got.includes("�")) return { kind: "binary", gotSize, wantSize }

  return { kind: "text", got, want }
}

/** Reads the file's state on the host and compares it with what the script wants. */
const readFileState = async (input: ReadFileStateInput): Promise<Result<HostState>> => {
  const { shell, path, wantedFile } = input

  const commandOutput = await shell.inspect(buildCheckCommand(path))
  if (isErr(commandOutput)) return commandOutput

  const findings = parseCheckOutput(commandOutput.stdout)
  if (isErr(findings)) return findings

  if (findings.kind === "link") return err(`'${path}' is a symlink, so file won't replace it`, undefined)
  if (findings.kind === "other") return err(`'${path}' isn't a regular file, so file won't replace it`, undefined)
  if (findings.kind === "unreadable")
    return err(`can't read '${path}' as the SSH user, so it needs sudo: true`, undefined)

  if (findings.kind === "absent") {
    const content: FileContent = { kind: "new", wantSize: wantedFile.size }
    return { inSync: false, comparison: { kind: "file", content, attributes: [] } }
  }

  const { remoteFile } = findings
  const content = await compareContent(input, remoteFile)
  if (isErr(content)) return content

  const attributes = findAttributeChanges(remoteFile, wantedFile)
  const inSync = content.kind === "same" && attributes.length === 0
  return { inSync, comparison: { kind: "file", content, attributes } }
}

// Check the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
const fileOptionsSchema = type({
  content: type("string").or(type.instanceOf(Uint8Array)),
  "mode?": type(OCTAL_MODE_PATTERN).or(SYMBOLIC_MODE_PATTERN),
  "owner?": "string | number",
  "group?": "string | number",
  "secret?": "boolean",
})

export const handleFile = async (
  ctx: StepContext,
  path: string,
  options: FileOptions,
): Promise<Result<StepDetails>> => {
  const { stepName, shell, home } = ctx
  const { secret = false, needs = [] } = options

  const validOptions = fileOptionsSchema(options)
  if (validOptions instanceof type.errors)
    return err(`failed to validate the options of step '${stepName}'`, err(validOptions.summary, undefined))

  const validNeeds = needsSchema({ needs })
  if (validNeeds instanceof type.errors)
    return err(`failed to validate the needs of step '${stepName}'`, err(validNeeds.summary, undefined))

  const absolutePath = toAbsolutePath(path, home)
  if (isErr(absolutePath)) return absolutePath

  const wantedFile = toWantedFile(options)
  const stepDetails = await converge(ctx, {
    needs,
    readState: async () => readFileState({ shell, path: absolutePath, wantedFile, secret }),
    // oxlint-disable-next-line typescript/require-await - the write comes with part 2 of `file`, and this stands in for it
    fix: async () => err("writing files comes with part 2 of file", undefined),
    verify: true,
  })

  return stepDetails
}
