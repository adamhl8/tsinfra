import { regex } from "arkregex"
import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { InputDescription } from "#session/handlers/shared/validate-input.ts"
import { validateInput } from "#session/handlers/shared/validate-input.ts"

// Refuse a relative path, because it would land wherever the shell starts. This also refuses `~user/`.
const hostPathSchema = type(regex("^(?:/|~(?:/|$))", "v")).describe("an absolute path, starting with / or ~/")
type HostPath = typeof hostPathSchema.infer

/** Replaces a leading `~/` or a bare `~` in `path` with `home`, the SSH user's home directory. */
export const resolveHome = (path: HostPath, home: string): Result<string> => {
  if (!path.startsWith("~")) return path

  if (home === "") return err(`can't resolve ~/ in '${path}', because $HOME isn't set on the host`, undefined)

  if (!home.startsWith("/"))
    return err(`can't resolve ~/ in '${path}', because $HOME on the host is '${home}', not an absolute path`, undefined)

  return `${home}${path.slice(1)}`
}

/** Validates a path the script gave a step, and resolves a leading `~` against the SSH user's home directory. */
export const validateHostPath = (path: unknown, home: string, description: InputDescription): Result<string> => {
  const validPath = validateInput(path, hostPathSchema, description)
  if (isErr(validPath)) return validPath

  return resolveHome(validPath, home)
}
