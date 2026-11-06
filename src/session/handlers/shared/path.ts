import { regex } from "arkregex"
import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

// Refuse a relative path, because it would land wherever the shell starts. This also refuses `~user/`.
export const hostPathSchema = type(regex("^(?:/|~(?:/|$))", "v")).describe("an absolute path, starting with / or ~/")
type HostPath = typeof hostPathSchema.infer

/** Replaces a leading `~/` or a bare `~` in `path` with `home`, the SSH user's home directory. */
export const resolveHome = (path: HostPath, home: string): Result<string> => {
  if (!path.startsWith("~")) return path

  if (home === "") return err(`can't resolve ~/ in '${path}', because $HOME isn't set on the host`, undefined)

  if (!home.startsWith("/"))
    return err(`can't resolve ~/ in '${path}', because $HOME on the host is '${home}', not an absolute path`, undefined)

  return `${home}${path.slice(1)}`
}
