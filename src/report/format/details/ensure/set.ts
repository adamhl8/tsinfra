import type { EnsureComparisonValues } from "#core/session/handlers/ensure/comparison.ts"
import type { DetailRows } from "#report/format/details.ts"
import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import { LINE_LIMIT_FLAG } from "#report/format/details/diff/limits.ts"
import { formatAlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { noteElement } from "#report/format/elements/messages.ts"
import { gotValueElement, wantValueElement } from "#report/format/elements/values.ts"

type SetValues = Extract<EnsureComparisonValues, { kind: "set" }>

/** Formats the note in place of `itemCount` differing items of a set, which are too many to show. */
const formatManyItemsNote = (itemCount: number): string =>
  noteElement(`${itemCount} items differ, run with ${LINE_LIMIT_FLAG} to see them`)

/**
 * Formats a set's `missing:` and `extra:` rows, `missing` first, because what the script wants is what a reader checks
 * first. Shows a row only for a side that has items. More items than `diffLimits` allows become a note.
 */
export const formatSetValues = ({ missing, extra }: SetValues, diffLimits: DiffLimits): DetailRows => {
  const itemCount = missing.length + extra.length
  if (diffLimits.maxLines !== undefined && itemCount > diffLimits.maxLines)
    return { kind: "unaligned", rows: [formatManyItemsNote(itemCount)] }

  const missingRows =
    missing.length > 0
      ? [
          formatAlignedRow(
            "missing",
            missing.map((item) => wantValueElement(item)),
          ),
        ]
      : []
  const extraRows =
    extra.length > 0
      ? [
          formatAlignedRow(
            "extra",
            extra.map((item) => gotValueElement(item)),
          ),
        ]
      : []
  return { kind: "aligned", rows: [...missingRows, ...extraRows] }
}
