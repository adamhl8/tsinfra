import { MASKED_VALUE } from "#session/session.ts"
import type { Style } from "#styles.ts"
import { styleCurrent, styleItalic, styleMuted, styleValue, styleWanted } from "#styles.ts"

/** A value the report shows: a string, or a boolean or a number, which shows differently so it can't pass for one. */
type Value = string | boolean | number

// Say "empty", not "blank", because a string of only whitespace shows quoted, not as a marker.
const EMPTY_MARKER = "(empty)"
// Mark a side of a change that has no value, like a key only one side of a record has, without saying what the fix does.
const NONE_MARKER = "(none)"
const EDGE_WHITESPACE = /^\s|\s$/v

/**
 * Applies the rules every value follows, in the color the element picks. A string shows as it is, except that an empty
 * one shows as a muted marker, and one that starts or ends with whitespace is quoted, with the quotes unstyled, so the
 * whitespace shows. Anything else is italic, because its text could otherwise pass for a string's, like `true` or
 * `501`, and `describe` can put words around one that's hard to read alone, like `exit code 1`.
 */
const applyValueRules = (
  value: Value,
  color: Style,
  describe: (value: boolean | number) => string = String,
): string => {
  if (typeof value !== "string") return styleItalic(color(describe(value)))
  if (value === "") return styleMuted(EMPTY_MARKER)
  return EDGE_WHITESPACE.test(value) ? `'${color(value)}'` : color(value)
}

/** Formats a value on one side of a comparison, in that side's color, with `describe` for a value that isn't a string. */
interface FormatSideValue {
  <T extends boolean | number>(value: T, describe?: (value: T) => string): string
  (value: Value): string
}

/** Formats a value the host has now, like a `got` value or the old side of a change. */
export const gotValueElement: FormatSideValue = (value: Value, describe?: (value: boolean | number) => string) =>
  applyValueRules(value, styleCurrent, describe)

/** Formats a value the script wants, like a `want` value or the new side of a change. */
export const wantValueElement: FormatSideValue = (value: Value, describe?: (value: boolean | number) => string) =>
  applyValueRules(value, styleWanted, describe)

/** Formats a value that changes, like `alice -> bob`, with a muted `(none)` for a side that has no value. */
export const changeElement = (got: Value | undefined, want: Value | undefined): string => {
  const gotText = got === undefined ? styleMuted(NONE_MARKER) : gotValueElement(got)
  const wantText = want === undefined ? styleMuted(NONE_MARKER) : wantValueElement(want)
  return `${gotText} -> ${wantText}`
}

/** Formats an option's value as its lines, and a masked one as a muted marker, because it's tsinfra's, not the script's. */
export const optionValueLineElements = (value: string | boolean): string[] => {
  if (typeof value === "boolean") return [applyValueRules(value, styleValue)]
  if (value === MASKED_VALUE) return [styleMuted(value)]
  return value.split("\n").map((line) => applyValueRules(line, styleValue))
}

/** Formats the value a warning is about, like the target in `nothing exists at target -> /x`. */
export const warningValueElement = (value: string): string => applyValueRules(value, styleValue)

/** Formats the exit code a command printed with, like `exit: 0`. */
export const exitCodeElement = (exitCode: number): string => applyValueRules(exitCode, styleValue)
