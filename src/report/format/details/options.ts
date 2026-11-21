import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { formatHeadingRow, formatKeyHeadingRow, formatKeyRow } from "#report/format/details/shared/aligned-row.ts"
import { headingElement, optionEntriesElement, optionNameElement } from "#report/format/elements/labels.ts"
import { optionValueLineElements } from "#report/format/elements/values.ts"
import { layoutRowsInOwnColumn } from "#report/format/layout.ts"
import type { StepOption } from "#report/host-block.ts"

/** Reports whether any of `options`, or any of their entries, kept a value through the filter. */
const hasValues = (options: StepOption[]): boolean =>
  options.some(({ value, entries }) => value !== undefined || hasValues(entries))

/** Formats the options line, like `options: env { URL, PORT }, secretEnv { TOKEN }`. */
const formatOptionsLine = (options: StepOption[]): string => {
  const optionsLineParts = options.map(({ name, entries }) =>
    entries.length > 0
      ? `${optionNameElement(name)} ${optionEntriesElement(entries.map((entry) => entry.name))}`
      : optionNameElement(name),
  )
  return `${headingElement("options")} ${optionsLineParts.join(", ")}`
}

/**
 * Formats options as rows: each as `name: value`, or as `name:` with its entries under it. An option whose value the
 * filter left out has no entries, so it shows as its name alone.
 */
const formatOptionRows = (options: StepOption[]): AlignedRow[] =>
  options.map(({ name, value, entries }) =>
    value === undefined
      ? formatKeyHeadingRow(name, formatOptionRows(entries))
      : formatKeyRow(name, optionValueLineElements(value.value)),
  )

/**
 * Formats the options as their rows: a block with each value when the values show, or one line naming the options when
 * they don't.
 */
export const formatOptions = (options: StepOption[]): string[] =>
  hasValues(options)
    ? layoutRowsInOwnColumn([formatHeadingRow("options", formatOptionRows(options))])
    : [formatOptionsLine(options)]
