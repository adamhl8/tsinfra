import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

/**
 * Returns `path` as an absolute path, with a leading `~/` or a bare `~` replaced by `home`, the SSH user's home
 * directory. Any other path must already start with `/`.
 */
export const toAbsolutePath = (path: string, home: string): Result<string> => {
  const isAbsolute = path.startsWith("/")
  if (isAbsolute) return path

  // Refuse a relative path, because it would land wherever the shell starts. This also refuses `~user/`.
  const isHomePath = path === "~" || path.startsWith("~/")
  if (!isHomePath) return err(`'${path}' isn't an absolute path, so start it with / or ~/`, undefined)

  if (home === "") return err(`can't resolve ~/ in '${path}', because $HOME isn't set on the host`, undefined)

  if (!home.startsWith("/"))
    return err(`can't resolve ~/ in '${path}', because $HOME on the host is '${home}', not an absolute path`, undefined)

  return `${home}${path.slice(1)}`
}
