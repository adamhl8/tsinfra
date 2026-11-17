import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Shell } from "#transport/transport.ts"
import { quoteShellArg } from "#utils.ts"

/** What the directory details script found at a path: nothing yet, or a directory. */
export interface HostDirDetails {
  kind: "absent" | "directory"
  path: string
}

const KIND_PREFIX = "kind="

// List what the directory details script can say is at the path.
const kindLineSchema = type("string")
  .narrow((line) => line.startsWith(KIND_PREFIX))
  .pipe((line) => line.slice(KIND_PREFIX.length))
  .to("'absent' | 'directory' | 'link' | 'other'")

/**
 * Returns one command that says what is at `path`. It checks for a symlink first, because `-d` follows one, and a link
 * to a directory isn't one `dir` manages.
 */
const buildDirDetailsScript = (path: string): string =>
  [
    `p=${quoteShellArg(path)}`,
    `if [ -L "$p" ]; then echo kind=link`,
    `elif [ ! -e "$p" ]; then echo kind=absent`,
    `elif [ -d "$p" ]; then echo kind=directory`,
    "else echo kind=other",
    "fi",
  ].join("\n")

/** Parses the directory details script's output. Returns an error for something at `path` that isn't a directory. */
export const parseDirDetailsOutput = (stdout: string, path: string): Result<HostDirDetails> => {
  const [kindLine = ""] = stdout.split("\n")

  const kind = kindLineSchema(kindLine)
  if (kind instanceof type.errors)
    return err(`the directory details script printed '${kindLine}' instead of what is at the path`, undefined)

  if (kind === "link") return err(`'${path}' is a symlink, so dir won't replace it`, undefined)
  if (kind === "other") return err(`'${path}' isn't a directory, so dir won't replace it`, undefined)
  return { kind, path }
}

/**
 * Reads what's at the directory's `path` on the host. Use `exec`, because every answer the command gives exits 0, so a
 * non-zero exit means it broke.
 */
export const getHostDirDetails = async (shell: Shell, path: string): Promise<Result<HostDirDetails>> => {
  const stdout = await shell.exec(buildDirDetailsScript(path), { label: "directory details script" })
  if (isErr(stdout)) return err(`failed to read the details of '${path}'`, stdout)

  return parseDirDetailsOutput(stdout, path)
}
