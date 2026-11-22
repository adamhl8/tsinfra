import path from "node:path"

import { stringWidth } from "bun"
import { err } from "ts-explicit-errors"

import type { CommandOutput } from "#core/transport.ts"

const TRAILING_NEWLINES = /\n+$/v
const TRAILING_NEWLINE = /\n$/v
const WHITESPACE = /\s+/v

/** Returns the widest of `texts` in terminal columns. */
export const getMaxWidth = (texts: string[]): number => Math.max(0, ...texts.map((value) => stringWidth(value)))

/** Pads `value` with spaces to `width` terminal columns. */
export const padToWidth = (value: string, width: number): string => value + " ".repeat(width - stringWidth(value))

/** Removes every newline at the end of `text`. */
export const stripTrailingNewlines = (text: string): string => text.replace(TRAILING_NEWLINES, "")

/** Removes one newline at the end of `text`, if it has one, and keeps any before it. */
export const stripOneTrailingNewline = (text: string): string => text.replace(TRAILING_NEWLINE, "")

/** Adds a newline to the end of `text`, unless it already ends with one. */
export const endWithNewline = (text: string): string => (text.endsWith("\n") ? text : `${text}\n`)

/** Splits `text` into its lines. An empty string has none, so it can't count as one empty line. */
export const splitLines = (text: string): string[] => (text === "" ? [] : text.split("\n"))

/** Splits `text` into its lines, leaving out the ones that are empty or only whitespace. */
export const splitNonEmptyLines = (text: string): string[] => text.split("\n").filter((line) => line.trim() !== "")

/** Splits `text` into its words, ignoring leading and trailing whitespace. */
export const splitWords = (text: string): string[] => text.trim().split(WHITESPACE)

/** Returns `count` with its noun, like `1 change` or `2 changes`. */
export const countOf = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/** Reports whether `value` is a plain object, made by `{}` or `Object.create(null)`, not by a class like `Map`. */
export const isPlainObject = (value: unknown): value is Record<PropertyKey, unknown> => {
  if (typeof value !== "object" || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Returns the value `record` has at `key`, or nothing when it doesn't have the key itself, like an inherited
 * `toString`.
 */
export const getOwnValue = <V>(record: Readonly<Record<string, V>> | undefined, key: string): V | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined

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

/** Wraps each name in single quotes and joins them into a list, like `'a', 'b'`. */
export const quoteNames = (names: Iterable<string>): string => Array.from(names, (name) => `'${name}'`).join(", ")

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
