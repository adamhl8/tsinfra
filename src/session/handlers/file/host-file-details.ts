import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HostFileAttributeDetails } from "#session/handlers/shared/filesystem/attributes.ts"
import type { Bytes } from "#session/handlers/shared/filesystem/bytes.ts"
import { toBytes } from "#session/handlers/shared/filesystem/bytes.ts"
import { statModeSchema } from "#session/handlers/shared/filesystem/mode.ts"
import type { Shell } from "#session/shell.ts"
import { quoteShellArg } from "#session/shell.ts"
import { nonEmptyStringSchema } from "#session/step.ts"
import { splitWords } from "#utils.ts"

// Read the first 64 hex characters, because GNU, busybox, and `shasum` print `<hash>  -`, and BSD prints the hash.
const SHA256_PATTERN = /^[0-9a-f]{64}/v
const SHA256_LENGTH = 64

/** What the file details command found about the content of a regular file. */
interface HostFileContentDetails {
  hash: string
  size: Bytes
}

/** The path of a file that doesn't exist on the host yet. */
interface NewHostFileDetails {
  kind: "new"
  path: string
}

/** What the file details command found at a path that is a regular file. */
interface ExistingHostFileDetails {
  kind: "existing"
  path: string
  content: HostFileContentDetails
  attributes: HostFileAttributeDetails
}

/** What the file details command found at a path: nothing yet, or a regular file. */
export type HostFileDetails = ExistingHostFileDetails | NewHostFileDetails

const KIND_PREFIX = "kind="

// List what the file details command can say is at the path.
const kindLineSchema = type("string")
  .narrow((line) => line.startsWith(KIND_PREFIX))
  .pipe((line) => line.slice(KIND_PREFIX.length))
  .to("'absent' | 'link' | 'other' | 'unreadable' | 'file'")

const hashLineSchema = type(SHA256_PATTERN).pipe((line) => line.slice(0, SHA256_LENGTH))

const statLineSchema = type("string")
  .pipe(splitWords)
  .to([
    statModeSchema,
    "string.integer.parse",
    "string.integer.parse",
    nonEmptyStringSchema,
    nonEmptyStringSchema,
    type("string.integer.parse").pipe(toBytes),
  ])
  .pipe(([mode, uid, gid, user, group, size]) => ({ attributes: { mode, uid, gid, user, group }, size }))

/**
 * Returns one command that says what is at `path`, and for a regular file, its sha256, mode, owner, and size. It tries
 * each common sha256 command, because POSIX has none, and feeds the file on stdin, because GNU `sha256sum` escapes odd
 * file names in its output. `stat -c` goes first, because GNU's `stat -f` prints filesystem information instead of
 * failing. BSD needs `%Mp%Lp` to keep setuid and setgid. Check that each sha256 command exists before running it, so a
 * missing one writes nothing to stderr. One that exists and fails keeps its stderr, because it says why a hash is
 * missing. Exit when no sha256 command gives a hash, because `stat` runs next, and its exit code would hide the
 * failure.
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
    `  { command -v sha256sum >/dev/null 2>&1 && sha256sum < "$p"; } ||`,
    `  { command -v shasum >/dev/null 2>&1 && shasum -a 256 < "$p"; } ||`,
    `  { command -v sha256 >/dev/null 2>&1 && sha256 < "$p"; } ||`,
    `  { echo 'failed to get the sha256 hash of the file on the host' >&2; exit 1; }`,
    `  stat -c '%a %u %g %U %G %s' "$p" 2>/dev/null || stat -f '%Mp%Lp %u %g %Su %Sg %z' "$p"`,
    "fi",
  ].join("\n")

/**
 * Parses the file details command's output, which differs between GNU, busybox, and BSD only in ways this allows for.
 * Returns `new` details when nothing is at `path`, and an error when something there isn't a file the step can read.
 */
export const parseFileDetailsOutput = (stdout: string, path: string): Result<HostFileDetails> => {
  const [kindLine = "", hashLine = "", statLine = ""] = stdout.split("\n")

  const kind = kindLineSchema(kindLine)
  if (kind instanceof type.errors)
    return err(`the file details command printed '${kindLine}' instead of what is at the path`, undefined)

  if (kind === "absent") return { kind: "new", path }
  if (kind === "link") return err(`'${path}' is a symlink, so file won't replace it`, undefined)
  if (kind === "other") return err(`'${path}' isn't a regular file, so file won't replace it`, undefined)
  if (kind === "unreadable") return err(`can't read '${path}' as the SSH user, so it needs sudo: true`, undefined)

  const hash = hashLineSchema(hashLine)
  if (hash instanceof type.errors)
    return err(`the file details command printed '${hashLine}' instead of the file's sha256 hash`, undefined)

  const fileStat = statLineSchema(statLine)
  if (fileStat instanceof type.errors)
    return err(`the file details command printed '${statLine}' instead of the file's mode, owner, and size`, undefined)

  const { attributes, size } = fileStat
  return { kind: "existing", path, content: { hash, size }, attributes }
}

/**
 * Reads the details of the file at `path` on the host. Use `exec`, because every answer the command gives exits 0, so a
 * non-zero exit means it broke.
 */
export const getHostFileDetails = async (shell: Shell, path: string): Promise<Result<HostFileDetails>> => {
  const stdout = await shell.exec(buildFileDetailsCommand(path), { label: "file details command" })
  if (isErr(stdout)) return err(`failed to read the details of '${path}'`, stdout)

  return parseFileDetailsOutput(stdout, path)
}
