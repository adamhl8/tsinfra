import {
  formatHeading,
  formatOptionKey,
  formatOptionEntries,
  formatOptionName,
  formatOptionValueLines,
} from "#report/format/elements/elements.ts"
import { INDENT } from "#report/format/layout.ts"
import type { StepOption } from "#report/host-block/host-block.ts"
import { getMaxWidth, padToWidth } from "#utils.ts"

/** Reports whether any of `options`, or any of their entries, kept a value through the filter. */
const hasValues = (options: StepOption[]): boolean =>
  options.some(({ value, entries }) => value !== undefined || hasValues(entries))

/** Formats the options line, like `options: env { URL, PORT }, secretEnv { TOKEN }`. */
const formatOptionsLine = (options: StepOption[]): string => {
  const optionsLineParts = options.map(({ name, entries }) =>
    entries.length > 0
      ? `${formatOptionName(name)} ${formatOptionEntries(entries.map((entry) => entry.name))}`
      : formatOptionName(name),
  )
  return `${formatHeading("options")} ${optionsLineParts.join(", ")}`
}

/**
 * Formats sibling options as block rows at `indent`: each as `name: value`, or as `name:` when it has no value, then
 * its entries one level deeper. Lines up the values of the siblings that have one, so they line up within one object,
 * and lines up a value's later lines under its first line's text.
 */
const formatOptionsBlockRows = (options: StepOption[], indent: string): string[] => {
  // Measure each key as it's formatted, with the space after it, so the width follows the key's own text.
  const valueLabels = options.flatMap(({ name, value }) => (value === undefined ? [] : [`${formatOptionKey(name)} `]))
  const labelWidth = getMaxWidth(valueLabels)
  const continuationIndent = " ".repeat(labelWidth)

  return options.flatMap(({ name, value, entries }) => {
    const label = formatOptionKey(name)
    const valueLines = value === undefined ? [] : formatOptionValueLines(value.value)
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
    ? [formatHeading("options"), ...formatOptionsBlockRows(options, INDENT)]
    : [formatOptionsLine(options)]
