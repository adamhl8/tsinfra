import nodePath from "node:path"

import type { OwnerOptions } from "#core/session/handlers/options/attributes.ts"
import type { HostOwner } from "#core/session/handlers/shared/filesystem/attributes.ts"
import type { ModeBits } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import { toOctalMode } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import { quoteShellArg } from "#core/utils.ts"

/** The temp path, inside the temp directory, as both write scripts name it, quoted for the shell. */
export const TEMP_PATH_ARG = '"$tmppath"'

/** The lines that remove the temp directory once the rename has put the new path in place. */
export const REMOVE_TEMP_DIRECTORY_LINES = [`rm -rf "$tmp"`, "trap - EXIT"]

// Write every mode as five octal digits, because GNU `chmod` keeps a directory's setuid and setgid bits for a numeric
// mode with fewer. BSD and busybox read the leading zeros as plain octal.
const FULL_OCTAL_MODE_WIDTH = 5

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

interface ChownLinesOptions extends OwnerOptions {
  /** Sets the owner of the file at the end of a symlink instead of the link itself. */
  follow?: boolean
}

interface AttributeLinesOptions extends ChownLinesOptions {
  /** The mode to set. The mode stays as it is when this is `undefined`. */
  modeBits: ModeBits | undefined
}

/**
 * Returns the `chown` line for the path, already quoted for the shell, or no lines when there's no owner to set.
 * Without `follow`, a link gets the owner and not what it points to.
 */
export const buildChownLines = (
  currentOwner: HostOwner | undefined,
  quotedPath: string,
  options: ChownLinesOptions,
): string[] => {
  const { follow = false } = options

  const ownerArg = getOwnerArg(currentOwner, options)
  if (ownerArg === undefined) return []

  // Keep `--`, because a user or group name comes from the script.
  const chown = follow ? "chown --" : "chown -h --"
  return [`${chown} ${quoteShellArg(ownerArg)} ${quotedPath}`]
}

/**
 * Returns the `chown` line, then the `chmod` line, for the path, already quoted for the shell. Leaves out the `chown`
 * when there's no owner to set, and the `chmod` when there's no mode. `chmod` always follows a link.
 */
export const buildAttributeLines = (
  currentOwner: HostOwner | undefined,
  quotedPath: string,
  options: AttributeLinesOptions,
): string[] => {
  const { modeBits } = options

  const chownLines = buildChownLines(currentOwner, quotedPath, options)
  const modeArg = modeBits === undefined ? undefined : toOctalMode(modeBits).padStart(FULL_OCTAL_MODE_WIDTH, "0")
  const chmodLines = modeArg === undefined ? [] : [`chmod ${modeArg} ${quotedPath}`]

  // Set the owner before the mode, because POSIX lets `chown` clear the setuid and setgid bits, and the mode must win.
  return [...chownLines, ...chmodLines]
}
