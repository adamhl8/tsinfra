import type { RecordValue } from "#core/session/handlers/ensure/comparison/record.ts"
import { isRecordList, isRecordSet } from "#core/session/handlers/ensure/comparison/record.ts"
import { RECORDED_STAND_INS } from "#core/session/recorder/records.ts"
import type { Style } from "#styles.ts"
import { styleCurrent, styleItalic, styleMuted, stylePlain, styleValue, styleWanted } from "#styles.ts"

/**
 * A value the report shows: a string, or a boolean, a number, `null`, a list, a set, or a record, which show
 * differently so they can't pass for one. It's any value a record can hold.
 */
type Value = RecordValue

// Show an empty string in the same quotes that show edge whitespace, so it reads as a string with nothing in it.
const EMPTY_MARKER = "''"
// Mark a side of a change that has no value, like a key only one side of a record has, without saying what the fix does.
// Keep the parentheses, so a value of `none` can't pass for it when the report has no color.
const NONE_MARKER = "(none)"
const EDGE_WHITESPACE = /^\s|\s$/v

/**
 * Returns `value` as one line of JSON with no spacing, except that a `Set` shows as `Set` before its items, like `Set
 * ["fd","jq"]`, at any depth, because JSON has no set. Shows a number as `String` does, because JSON writes `Infinity`
 * as `null`. Keeps a record's own key order.
 */
const toOneLineJson = (value: Value): string => {
  if (isRecordSet(value)) return `Set ${toOneLineJson([...value])}`
  if (isRecordList(value)) return `[${value.map((item) => toOneLineJson(item)).join(",")}]`
  if (typeof value === "number") return String(value)
  if (typeof value !== "object" || value === null) return JSON.stringify(value)

  const entryTexts = Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}:${toOneLineJson(item)}`)
  return `{${entryTexts.join(",")}}`
}

/**
 * Applies the rules every value follows, in the color the element picks. A string shows as it is, except that an empty
 * one shows as muted quotes, and one that starts or ends with whitespace is quoted, with the quotes unstyled, so the
 * whitespace shows. Anything else is italic, because its text could otherwise pass for a string's, like `true` or
 * `501`, and `describe` can put words around one that's hard to read alone, like `exit code 1`. `null`, a list, a set,
 * and a record show on one line, by `toOneLineJson`.
 */
const applyValueRules = (
  value: Value,
  color: Style,
  describe: (value: boolean | number) => string = String,
): string => {
  if (typeof value === "object") return styleItalic(color(toOneLineJson(value)))
  if (typeof value !== "string") return styleItalic(color(describe(value)))
  if (value === "") return styleMuted(EMPTY_MARKER)
  return EDGE_WHITESPACE.test(value) ? `'${color(value)}'` : color(value)
}

/** Formats a value on one side of a comparison, in that side's color, with `describe` for a value that isn't a string. */
interface FormatSideValue {
  <T extends boolean | number>(value: T, describe?: (value: T) => string): string
  (value: Value): string
}

/**
 * Formats a key of a record, or of an option's entries, with its colon, like `TZ:`. Shows the key in the value color by
 * the string rules, because the script or the host named it, so it can't pass for one of tsinfra's labels. Mutes the
 * colon, like a label's.
 */
export const keyElement = (key: string): string => `${applyValueRules(key, styleValue)}${styleMuted(":")}`

/** Formats a value the host has now, like a `got` value or the old side of a change. */
export const gotValueElement: FormatSideValue = (value: Value, describe?: (value: boolean | number) => string) =>
  applyValueRules(value, styleCurrent, describe)

/** Formats a value the script wants, like a `want` value or the new side of a change. */
export const wantValueElement: FormatSideValue = (value: Value, describe?: (value: boolean | number) => string) =>
  applyValueRules(value, styleWanted, describe)

/**
 * Formats a value a check found against an empty `want`, in the value color, because it's from the host but isn't a
 * side of a change.
 */
export const foundValueElement = (value: Value): string => applyValueRules(value, styleValue)

/** Formats a value neither side changes, like a list diff's unchanged item, in the terminal's own text color. */
const unchangedValueElement = (value: Value): string => applyValueRules(value, stylePlain)

/** Whether a list diff's item is only on the host, only in `want`, or on both. */
export type ListItemChange = "removed" | "added" | "unchanged"

/**
 * Formats a list diff's item after its mark, by the value rules: a removed one like what's on the host, an added one
 * like what the script wants, and an unchanged one in the terminal's own text color. Styles the mark and the item
 * apart, because the value rules leave the quotes around edge whitespace unstyled.
 */
export const listDiffItemElement = (itemChange: ListItemChange, item: Value): string => {
  if (itemChange === "removed") return `${styleCurrent("-")}${gotValueElement(item)}`
  if (itemChange === "added") return `${styleWanted("+")}${wantValueElement(item)}`
  return ` ${unchangedValueElement(item)}`
}

/**
 * Formats a value that changes, like `alice -> bob`, with `(none)` for a side that has no value. Styles `(none)` muted
 * and italic, like a note, because it's tsinfra saying nothing is there.
 */
export const changeElement = (got: Value | undefined, want: Value | undefined): string => {
  const gotText = got === undefined ? styleItalic(styleMuted(NONE_MARKER)) : gotValueElement(got)
  const wantText = want === undefined ? styleItalic(styleMuted(NONE_MARKER)) : wantValueElement(want)
  return `${gotText} -> ${wantText}`
}

// Mute these, because each stands in for a value the record never holds.
const OPTION_STAND_INS = new Set<string>(Object.values(RECORDED_STAND_INS))

/** Formats an option's value as its lines, and a stand-in as a muted marker. */
export const optionValueLineElements = (value: string | boolean): string[] => {
  if (typeof value === "boolean") return [applyValueRules(value, styleValue)]
  if (OPTION_STAND_INS.has(value)) return [styleMuted(value)]
  return value.split("\n").map((line) => applyValueRules(line, styleValue))
}

/** Formats the value a warning is about, like the target in `nothing exists at target -> /x`. */
export const warningValueElement = (value: string): string => applyValueRules(value, styleValue)

/** Formats the exit code a command printed with, like `exit: 0`. */
export const exitCodeElement = (exitCode: number): string => applyValueRules(exitCode, styleValue)
