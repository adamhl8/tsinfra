import nodePath from "node:path"

import type { HostOwner, OwnerOptions } from "#session/handlers/shared/filesystem/attributes.ts"
import { quoteShellArg } from "#session/shell.ts"

/** The quoted paths a write script uses. */
interface WriteScriptPaths {
  quotedPath: string
  quotedDirectory: string
  quotedTempTemplate: string
}

/** Returns `chown`'s `user:group`, each the one given and then the current one, or nothing with neither. */
const getOwnerArg = (currentOwner: HostOwner | undefined, options: OwnerOptions): string | undefined => {
  const user = options.user ?? currentOwner?.uid
  const group = options.group ?? currentOwner?.gid
  if (user === undefined && group === undefined) return undefined

  return `${user ?? ""}${group === undefined ? "" : `:${group}`}`
}

/**
 * Returns the quoted path, its directory, and a `mktemp` template for a temp name in that directory. The temp name sits
 * next to the path, so the final rename stays on one filesystem.
 */
export const toWriteScriptPaths = (path: string): WriteScriptPaths => {
  const directory = nodePath.posix.dirname(path)
  const tempTemplate = nodePath.posix.join(directory, `.${nodePath.posix.basename(path)}.tsinfra.XXXXXX`)

  return {
    quotedPath: quoteShellArg(path),
    quotedDirectory: quoteShellArg(directory),
    quotedTempTemplate: quoteShellArg(tempTemplate),
  }
}

/** Returns the `chown` line for the temp path, already quoted for the shell, or no lines when there's no owner to set. */
export const buildChownLines = (
  currentOwner: HostOwner | undefined,
  quotedTempPath: string,
  options: OwnerOptions,
): string[] => {
  const ownerArg = getOwnerArg(currentOwner, options)
  if (ownerArg === undefined) return []

  // Use `-h`, so a link gets the owner and not what it points to. It changes nothing for a regular file.
  // Keep `--`, because a user or group name comes from the script.
  return [`chown -h -- ${quoteShellArg(ownerArg)} ${quotedTempPath}`]
}
