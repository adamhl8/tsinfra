import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { Bytes } from "#session/handlers/file/bytes.ts"
import { toBytes } from "#session/handlers/file/bytes.ts"
import { quoteShellArg } from "#session/shell.ts"

const SHA256_LENGTH = 64
const SHA256_PATTERN = /^[0-9a-f]{64}/v
const WHITESPACE = /\s+/v

/** What the state command found at a path that is a regular file. */
export interface HostFile {
  hash: string
  mode: number
  uid: number
  gid: number
  user: string
  group: string
  size: Bytes
}

export type PathFindings =
  | { kind: "absent" }
  | { kind: "link" }
  | { kind: "other" }
  | { kind: "unreadable" }
  | { kind: "file"; hostFile: HostFile }

/**
 * Returns one command that says what is at `path`, and for a regular file, its sha256, mode, owner, and size. It tries
 * each common sha256 command, because POSIX has none, and feeds the file on stdin, because GNU `sha256sum` escapes odd
 * file names in its output. `stat -c` goes first, because GNU's `stat -f` prints filesystem information instead of
 * failing. BSD needs `%Mp%Lp` to keep setuid and setgid.
 */
export const buildStateCommand = (path: string): string =>
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

/** Parses the state command's output, which differs between GNU, busybox, and BSD only in ways this allows for. */
export const parseStateOutput = (stdout: string): Result<PathFindings> => {
  const [kindLine = "", hashLine = "", statLine = ""] = stdout.split("\n")
  const kind = kindLine.replace("kind=", "")

  if (kind === "absent" || kind === "link" || kind === "other" || kind === "unreadable") return { kind }
  if (kind !== "file")
    return err(`the file's state command printed '${kindLine}' instead of what is at the path`, undefined)

  // Read the first 64 hex characters, because GNU, busybox, and `shasum` print `<hash>  -`, and BSD prints the hash.
  const hash = SHA256_PATTERN.exec(hashLine)?.[0]
  if (hash?.length !== SHA256_LENGTH)
    return err("the file's state command found no sha256 command (sha256sum, shasum, or sha256) on the host", undefined)

  const [mode = "", uid = "", gid = "", user = "", group = "", size = ""] = statLine.trim().split(WHITESPACE)
  // Parse the mode as octal, because GNU prints `644` and BSD prints `0644`.
  const hostFile = {
    hash,
    mode: Number.parseInt(mode, 8),
    uid: Number(uid),
    gid: Number(gid),
    user,
    group,
    size: toBytes(Number(size)),
  }
  if ([hostFile.mode, hostFile.uid, hostFile.gid, hostFile.size].some((value) => Number.isNaN(value)))
    return err(`the file's state command printed '${statLine}' instead of the file's mode, owner, and size`, undefined)

  return { kind: "file", hostFile }
}
