import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HostFileAttributeDetails } from "#session/handlers/shared/shared.ts"
import { buildStatCommand, STAT_OWNER_COLUMNS, statModeSchema } from "#session/handlers/shared/shared.ts"
import type { Shell } from "#transport/transport.ts"
import { quoteShellArg, splitWords } from "#utils.ts"

/** The path of a directory that doesn't exist on the host yet. */
interface NewHostDirDetails {
  kind: "new"
  path: string
}

/** What the directory details script found at a path that is a directory. */
interface ExistingHostDirDetails {
  kind: "existing"
  path: string
  attributes: HostFileAttributeDetails
}

/** What the directory details script found at a path: nothing yet, or a directory. */
export type HostDirDetails = ExistingHostDirDetails | NewHostDirDetails

const KIND_PREFIX = "kind="

// List what the directory details script can say is at the path.
const kindLineSchema = type("string")
  .narrow((line) => line.startsWith(KIND_PREFIX))
  .pipe((line) => line.slice(KIND_PREFIX.length))
  .to("'absent' | 'link' | 'other' | 'directory'")

const statLineSchema = type("string")
  .pipe(splitWords)
  .to([statModeSchema, ...STAT_OWNER_COLUMNS])
  .pipe(([mode, uid, gid, user, group]): HostFileAttributeDetails => ({ mode, uid, gid, user, group }))

/**
 * Returns one command that says what is at `path`, and for a directory, its mode and owner. It checks for a symlink
 * first, because `-d` follows one, and a link to a directory isn't one `dir` manages.
 */
const buildDirDetailsScript = (path: string): string =>
  [
    `p=${quoteShellArg(path)}`,
    `if [ -L "$p" ]; then echo kind=link`,
    `elif [ ! -e "$p" ]; then echo kind=absent`,
    `elif [ ! -d "$p" ]; then echo kind=other`,
    "else",
    "  echo kind=directory",
    `  ${buildStatCommand('"$p"', ["mode", "owner"])}`,
    "fi",
  ].join("\n")

/**
 * Parses the directory details script's output. Returns `new` details when nothing is at `path`, and an error when
 * something there isn't a directory.
 */
export const parseDirDetailsOutput = (stdout: string, path: string): Result<HostDirDetails> => {
  const [kindLine = "", statLine = ""] = stdout.split("\n")

  const kind = kindLineSchema(kindLine)
  if (kind instanceof type.errors)
    return err(`the directory details script printed '${kindLine}' instead of what is at the path`, undefined)

  if (kind === "absent") return { kind: "new", path }
  if (kind === "link") return err(`'${path}' is a symlink, so dir won't replace it`, undefined)
  if (kind === "other") return err(`'${path}' isn't a directory, so dir won't replace it`, undefined)

  const attributes = statLineSchema(statLine)
  if (attributes instanceof type.errors) {
    return err(
      `the directory details script printed '${statLine}' instead of the directory's mode and owner`,
      undefined,
    )
  }

  return { kind: "existing", path, attributes }
}

/**
 * Reads the details of the directory at `path` on the host. Use `exec`, because every answer the command gives exits 0,
 * so a non-zero exit means it broke.
 */
export const getHostDirDetails = async (shell: Shell, path: string): Promise<Result<HostDirDetails>> => {
  const stdout = await shell.exec(buildDirDetailsScript(path), { label: "directory details script" })
  if (isErr(stdout)) return err(`failed to read the details of '${path}'`, stdout)

  return parseDirDetailsOutput(stdout, path)
}
