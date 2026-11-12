import { INDENT } from "#report/format/layout.ts"
import type { StepOption } from "#report/host-block/host-block.ts"
import { MASKED_VALUE } from "#session/session.ts"
import { styleAside, styleLabel, styleNote, styleValue, styleValueBoolean } from "#styles.ts"
import { getMaxWidth, padToWidth } from "#utils.ts"

/** Reports whether any of `options`, or any of their entries, kept a value through the filter. */
const hasValues = (options: StepOption[]): boolean =>
  options.some(({ value, entries }) => value !== undefined || hasValues(entries))

/** Formats one option for the options line: its name, and its entries' names after it, like `env: URL, PORT`. */
const formatOptionsLinePart = ({ name, entries }: StepOption): string => {
  const entryNames = entries.map(({ name: entryName }) => styleValue(entryName))
  return entries.length > 0 ? `${styleLabel(`${name}:`)} ${entryNames.join(", ")}` : styleLabel(name)
}

/** Formats the options line, like `options: env: URL, PORT, secretEnv: TOKEN`. */
const formatOptionsLine = (options: StepOption[]): string => {
  const optionsLineParts = options.map((option) => formatOptionsLinePart(option))
  return `${styleNote("options:")} ${optionsLineParts.join(", ")}`
}

/**
 * Formats a value as its lines. Italicizes a boolean, because it isn't quoted. Dims a masked value, unquoted, because
 * it's tsinfra's marker, not a value the script gave. Quotes any other string with the quotes uncolored, so an empty
 * one still shows.
 */
const formatValueLines = (value: string | boolean): string[] => {
  if (typeof value === "boolean") return [styleValueBoolean(String(value))]
  if (value === MASKED_VALUE) return [styleAside(value)]

  const valueLines = value.split("\n")
  const lastIndex = valueLines.length - 1
  return valueLines.map((valueLine, index) => {
    const openingQuote = index === 0 ? "'" : ""
    const closingQuote = index === lastIndex ? "'" : ""
    return `${openingQuote}${styleValue(valueLine)}${closingQuote}`
  })
}

/**
 * Formats sibling options as block rows at `indent`: each as `name: value`, or as `name:` when it has no value, then
 * its entries one level deeper. Lines up the values of the siblings that have one, so they line up within one object,
 * and lines up a value's later lines under its first line's text.
 */
const formatOptionsBlockRows = (options: StepOption[], indent: string): string[] => {
  const valueLabels = options.flatMap(({ name, value }) => (value === undefined ? [] : [`${name}: `]))
  const labelWidth = getMaxWidth(valueLabels)
  const continuationIndent = " ".repeat(labelWidth)

  return options.flatMap(({ name, value, entries }) => {
    const label = styleLabel(`${name}:`)
    const valueLines = value === undefined ? [] : formatValueLines(value.value)
    const valueRows = valueLines.map((valueLine, index) => {
      const lineStart = index === 0 ? padToWidth(label, labelWidth) : continuationIndent
      return `${indent}${lineStart}${valueLine}`
    })
    const nameRows = value === undefined ? [`${indent}${label}`] : valueRows
    const entryRows = formatOptionsBlockRows(entries, `${indent}${INDENT}`)
    return [...nameRows, ...entryRows]
  })
}

/**
 * Formats the options as their rows: a block with each value when the values show, or one line naming the options when
 * they don't.
 */
export const formatOptions = (options: StepOption[]): string[] =>
  hasValues(options)
    ? [styleNote("options:"), ...formatOptionsBlockRows(options, INDENT)]
    : [formatOptionsLine(options)]
