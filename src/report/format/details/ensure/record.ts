import type { DetailRows } from "#report/format/details/details.ts"
import type { DiffLimits } from "#report/format/details/diff/diff.ts"
import { LINE_LIMIT_FLAG } from "#report/format/details/diff/diff.ts"
import { formatKeyRow } from "#report/format/details/shared/shared.ts"
import { changeElement, noteElement } from "#report/format/elements/elements.ts"
import type { RecordComparisonValues } from "#session/session.ts"

/** Formats the note in place of `keyCount` differing keys of a record, which are too many to show. */
const formatManyKeysNote = (keyCount: number): string =>
  noteElement(`${keyCount} keys differ, run with ${LINE_LIMIT_FLAG} to see them`)

/**
 * Formats a record's rows, one per key that differs, from the host's value to the wanted one, with `(none)` for a side
 * without the key. Shows the keys in `want`'s order, then the extra ones in the check's order. More keys than
 * `diffLimits` allows become a note.
 */
export const formatRecordValues = (
  { want, missing, extra, changed }: RecordComparisonValues,
  diffLimits: DiffLimits,
): DetailRows => {
  const wantRows = Object.keys(want).flatMap((key) => {
    const changedValues = changed[key]
    if (changedValues) return [formatKeyRow(key, [changeElement(changedValues.got, changedValues.want)])]
    return Object.hasOwn(missing, key) ? [formatKeyRow(key, [changeElement(undefined, missing[key])])] : []
  })
  const extraRows = Object.entries(extra).map(([key, value]) => formatKeyRow(key, [changeElement(value, undefined)]))
  const rows = [...wantRows, ...extraRows]

  if (diffLimits.maxLines !== undefined && rows.length > diffLimits.maxLines)
    return { kind: "unaligned", rows: [formatManyKeysNote(rows.length)] }

  return { kind: "aligned", rows }
}
