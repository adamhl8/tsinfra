import path from "node:path"

import { isPlainObject } from "remeda"
import { err } from "ts-explicit-errors"

import type { CommandOutput } from "#core/transport.ts"

// Match only from the start of a run of newlines, because trying each newline in a long run is slow.
const TRAILING_NEWLINES = /(?<!\n)\n+$/v
const TRAILING_NEWLINE = /\n$/v
const WHITESPACE = /\s+/v

/** Removes every newline at the end of `text`. */
export const stripTrailingNewlines = (text: string): string => text.replace(TRAILING_NEWLINES, "")

/** Removes one newline at the end of `text`, if it has one, and keeps any before it. */
export const stripOneTrailingNewline = (text: string): string => text.replace(TRAILING_NEWLINE, "")

/** Splits `text` into its words, ignoring leading and trailing whitespace. */
export const splitWords = (text: string): string[] => text.trim().split(WHITESPACE)

/**
 * Names the type of `value`, saying "array" for an array and its class's name for any other object that isn't plain,
 * like `Set`, because `typeof` says "object" for all of them.
 */
export const describeType = (value: unknown): string => {
  if (Array.isArray(value)) return "array"
  const isClassInstance = typeof value === "object" && value !== null && !isPlainObject(value)
  if (isClassInstance) return value.constructor.name
  return typeof value
}

/** Describes a non-zero exit as an error, with the exit code and stderr in its message. */
export const createCommandExitError = (commandOutput: CommandOutput) => {
  const { stderr, exitCode } = commandOutput
  let trimmedStderr = stderr.trim()
  trimmedStderr &&= `: ${trimmedStderr}`
  return err(`exited with code ${exitCode}${trimmedStderr}`, undefined)
}

/** Quotes `text` for a POSIX shell, so a space or a quote in it can't break the command. */
export const quoteShellArg = (text: string): string => `'${text.replaceAll("'", String.raw`'\''`)}'`

interface PrivateFileWriteOptions {
  /** Makes the file executable by its owner, like a helper another program runs. */
  executable?: boolean
}

/**
 * Returns a script that writes `content` to `filePath` on the host, readable only by its owner, replacing any file
 * there. Write it under a temp name and rename it into place, so a write cut short leaves the old file whole. Set
 * `umask 077`, because `mkdir -p -m 700` sets the mode of the last directory only, and the umask makes every directory
 * the script creates `700` and the file `600`.
 */
export const buildPrivateFileWriteScript = (
  filePath: string,
  content: string,
  options: PrivateFileWriteOptions = {},
): string => {
  const { executable = false } = options
  const quotedFilePath = quoteShellArg(filePath)
  return [
    "set -eu",
    "umask 077",
    `mkdir -p ${quoteShellArg(path.posix.dirname(filePath))}`,
    `tmp=${quotedFilePath}.$$`,
    `printf '%s' ${quoteShellArg(content)} >"$tmp"`,
    ...(executable ? [`chmod 700 "$tmp"`] : []),
    `mv -f "$tmp" ${quotedFilePath}`,
  ].join("\n")
}
