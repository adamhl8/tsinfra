import type { EnsureComparisonValues } from "#core/session/handlers/ensure/comparison.ts"
import type { RecordPrimitive } from "#core/session/handlers/ensure/comparison/record.ts"
import type { DetailRows } from "#report/format/details.ts"
import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import { LINE_LIMIT_FLAG, isPastLineLimit } from "#report/format/details/diff/limits.ts"
import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { noteElement } from "#report/format/elements/asides.ts"
import { gotValueElement, wantValueElement } from "#report/format/elements/values.ts"

type SetValues = Extract<EnsureComparisonValues, { kind: "set" }>

/** Formats the note in place of `itemCount` differing items of a set, which are too many to show. */
const formatManyItemsNote = (itemCount: number): string =>
  noteElement(`${itemCount} items differ, run with ${LINE_LIMIT_FLAG} to see them`)

/**
 * Formats a set's `missing:` and `extra:` rows, `missing` first, because what the script wants is what a reader checks
 * first. Shows a row only for a side that has items.
 */
export const formatSetRows = (missing: readonly RecordPrimitive[], extra: readonly RecordPrimitive[]): AlignedRow[] => {
  const sides = [
    { label: "missing", valueLines: missing.map((item) => wantValueElement(item)) },
    { label: "extra", valueLines: extra.map((item) => gotValueElement(item)) },
  ]
  return sides
    .filter(({ valueLines }) => valueLines.length > 0)
    .map(({ label, valueLines }) => formatAlignedRow(label, valueLines))
}

/**
 * Formats a set's `missing:` and `extra:` rows, like `formatSetRows`. More items than `diffLimits` allows become a
 * note.
 */
export const formatSetValues = ({ missing, extra }: SetValues, diffLimits: DiffLimits): DetailRows => {
  const itemCount = missing.length + extra.length
  if (isPastLineLimit(itemCount, diffLimits)) return { kind: "unaligned", rows: [formatManyItemsNote(itemCount)] }

  return { kind: "aligned", rows: formatSetRows(missing, extra) }
}
