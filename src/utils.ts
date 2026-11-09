import { stringWidth } from "bun"
import { err } from "ts-explicit-errors"

import type { CommandOutput } from "#transport/transport.ts"

/** What failed, or `undefined` when nothing did. */
export type Failure = Error | undefined

const TRAILING_NEWLINES = /\n+$/v
const TRAILING_NEWLINE = /\n$/v
const WHITESPACE = /\s+/v

/** Returns the widest of `texts` in terminal columns. */
export const getMaxWidth = (texts: string[]): number => Math.max(0, ...texts.map((value) => stringWidth(value)))

/** Pads `value` with spaces to `width` terminal columns. */
export const padToWidth = (value: string, width: number): string => value + " ".repeat(width - stringWidth(value))

/** Reports whether `text` spans more than one line. */
export const isMultiLine = (text: string): boolean => text.includes("\n")

/** Removes every newline at the end of `text`. */
export const stripTrailingNewlines = (text: string): string => text.replace(TRAILING_NEWLINES, "")

/** Removes one newline at the end of `text`, if it has one, and keeps any before it. */
export const stripOneTrailingNewline = (text: string): string => text.replace(TRAILING_NEWLINE, "")

/** Adds a newline to the end of `text`, unless it already ends with one. */
export const endWithNewline = (text: string): string => (text.endsWith("\n") ? text : `${text}\n`)

/** Splits `text` into its lines, leaving out the ones that are empty or only whitespace. */
export const splitNonEmptyLines = (text: string): string[] => text.split("\n").filter((line) => line.trim() !== "")

/** Splits `text` into its words, ignoring leading and trailing whitespace. */
export const splitWords = (text: string): string[] => text.trim().split(WHITESPACE)

/** Wraps each name in single quotes and joins them into a list, like `'a', 'b'`. */
export const quoteNames = (names: Iterable<string>): string => Array.from(names, (name) => `'${name}'`).join(", ")

/** Describes a non-zero exit as an error, with the exit code and stderr in its message. */
export const createCommandExitError = (commandOutput: CommandOutput) => {
  const { stderr, exitCode } = commandOutput
  let trimmedStderr = stderr.trim()
  trimmedStderr &&= `: ${trimmedStderr}`
  return err(`exited with code ${exitCode}${trimmedStderr}`, undefined)
}
