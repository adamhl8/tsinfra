import { regex } from "arkregex"
import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { HomeDirectory } from "#core/hosts/prepare/host-details.ts"
import type { InputDescription } from "#core/session/handlers/shared/validate-input.ts"
import { validateInput } from "#core/session/handlers/shared/validate-input.ts"

// Refuse a relative path, because it would land wherever the shell starts. This also refuses `~user/`.
const hostPathSchema = type(regex("^(?:/|~(?:/|$))", "v")).describe("an absolute path, starting with / or ~/")
type HostPath = typeof hostPathSchema.infer

/** Replaces a leading `~/` or a bare `~` in `path` with `home`, the SSH user's home directory. */
export const resolveHome = (path: HostPath, home: HomeDirectory): string =>
  path.startsWith("~") ? `${home}${path.slice(1)}` : path

/** Validates a path the script gave a step, and resolves a leading `~` against the SSH user's home directory. */
export const validateHostPath = (path: unknown, home: HomeDirectory, description: InputDescription): Result<string> => {
  const validPath = validateInput(path, hostPathSchema, description)
  if (isErr(validPath)) return validPath

  return resolveHome(validPath, home)
}
