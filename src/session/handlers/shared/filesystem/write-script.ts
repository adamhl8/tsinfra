import nodePath from "node:path"

import type { HostOwner, OwnerOptions } from "#session/handlers/shared/filesystem/attributes.ts"
import { quoteShellArg } from "#utils.ts"

/** The temp path, inside the temp directory, as both write scripts name it, quoted for the shell. */
export const TEMP_PATH_ARG = '"$tmppath"'

/** The lines that remove the temp directory once the rename has put the new path in place. */
export const REMOVE_TEMP_DIRECTORY_LINES = [`rm -rf "$tmp"`, "trap - EXIT"]

/** The quoted paths a write script uses. */
interface WriteScriptPaths {
  quotedPath: string
  quotedDirectory: string
  /** The path's last part, for a temp file that keeps the destination's name, extension included. */
  quotedName: string
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
 * Returns the quoted path, its directory, its name, and a `mktemp -d` template for a temp directory next to it. The
 * temp directory sits next to the path, so the final rename stays on one filesystem.
 */
export const toWriteScriptPaths = (path: string): WriteScriptPaths => {
  const directory = nodePath.posix.dirname(path)
  const name = nodePath.posix.basename(path)
  const tempTemplate = nodePath.posix.join(directory, `.${name}.tsinfra.XXXXXX`)

  return {
    quotedPath: quoteShellArg(path),
    quotedDirectory: quoteShellArg(directory),
    quotedName: quoteShellArg(name),
    quotedTempTemplate: quoteShellArg(tempTemplate),
  }
}

/**
 * Returns the lines that make a private temp directory next to the path, removed if the script fails, with a temp path
 * in it named like the path.
 */
export const buildTempDirectoryLines = (writeScriptPaths: WriteScriptPaths): string[] => {
  const { quotedName, quotedTempTemplate } = writeScriptPaths
  return [`tmp=$(mktemp -d ${quotedTempTemplate})`, `trap 'rm -rf "$tmp"' EXIT`, `tmppath="$tmp"/${quotedName}`]
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
