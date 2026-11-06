import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Bytes } from "#session/handlers/file/bytes.ts"
import { toBytes } from "#session/handlers/file/bytes.ts"
import type { Shell } from "#session/shell.ts"
import { quoteShellArg } from "#session/shell.ts"
import { nonEmptyStringSchema } from "#session/step.ts"

const SHA256_PATTERN = /^[0-9a-f]{64}/v
const WHITESPACE = /\s+/v

/** What the file details command found at a path that is a regular file. */
export interface HostFileDetails {
  path: string
  hash: string
  mode: number
  uid: number
  gid: number
  user: string
  group: string
  size: Bytes
}

// Parse the mode as octal, because GNU prints `644` and BSD prints `0644`.
const statLineSchema = type([
  type(/^[0-7]+$/v).pipe((mode) => Number.parseInt(mode, 8)),
  "string.integer.parse",
  "string.integer.parse",
  nonEmptyStringSchema,
  nonEmptyStringSchema,
  type("string.integer.parse").pipe(toBytes),
])

/**
 * Returns one command that says what is at `path`, and for a regular file, its sha256, mode, owner, and size. It tries
 * each common sha256 command, because POSIX has none, and feeds the file on stdin, because GNU `sha256sum` escapes odd
 * file names in its output. `stat -c` goes first, because GNU's `stat -f` prints filesystem information instead of
 * failing. BSD needs `%Mp%Lp` to keep setuid and setgid.
 */
const buildFileDetailsCommand = (path: string): string =>
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

/**
 * Parses the file details command's output, which differs between GNU, busybox, and BSD only in ways this allows for.
 * Returns undefined when nothing is at `path`, and an error when something there isn't a file the step can read.
 */
export const parseFileDetailsOutput = (stdout: string, path: string): Result<HostFileDetails | undefined> => {
  const [kindLine = "", hashLine = "", statLine = ""] = stdout.split("\n")
  const kind = kindLine.replace("kind=", "")

  if (kind === "absent") return undefined
  if (kind === "link") return err(`'${path}' is a symlink, so file won't replace it`, undefined)
  if (kind === "other") return err(`'${path}' isn't a regular file, so file won't replace it`, undefined)
  if (kind === "unreadable") return err(`can't read '${path}' as the SSH user, so it needs sudo: true`, undefined)
  if (kind !== "file")
    return err(`the file details command printed '${kindLine}' instead of what is at the path`, undefined)

  // Read the first 64 hex characters, because GNU, busybox, and `shasum` print `<hash>  -`, and BSD prints the hash.
  const hash = SHA256_PATTERN.exec(hashLine)?.[0]
  if (hash === undefined)
    return err("the file details command found no sha256 command (sha256sum, shasum, or sha256) on the host", undefined)

  const validStatLine = statLineSchema(statLine.trim().split(WHITESPACE))
  if (validStatLine instanceof type.errors)
    return err(`the file details command printed '${statLine}' instead of the file's mode, owner, and size`, undefined)

  const [mode, uid, gid, user, group, size] = validStatLine
  return { path, hash, mode, uid, gid, user, group, size }
}

/** Reads the details of the file at `path` on the host, or undefined when nothing is there. */
export const getHostFileDetails = async (shell: Shell, path: string): Promise<Result<HostFileDetails | undefined>> => {
  const commandOutput = await shell.inspect(buildFileDetailsCommand(path))
  if (isErr(commandOutput)) return commandOutput

  return parseFileDetailsOutput(commandOutput.stdout, path)
}
