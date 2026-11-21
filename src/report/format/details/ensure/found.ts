import type { RecordWant } from "#core/session/handlers/ensure/comparison/record.ts"
import type { DetailRows } from "#report/format/details.ts"
import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import { LINE_LIMIT_FLAG, isPastLineLimit } from "#report/format/details/diff/limits.ts"
import {
  countRowLines,
  formatAlignedRow,
  formatKeyRow,
  formatLabelHeadingRow,
} from "#report/format/details/shared/aligned-row.ts"
import { noteElement } from "#report/format/elements/messages.ts"
import { foundValueElement } from "#report/format/elements/values.ts"
import { countOf } from "#utils.ts"

/** Formats the note in place of `count` found items or keys, which are too many to show. */
const formatManyFoundNote = (count: number, singular: string, plural: string): string =>
  noteElement(`${countOf(count, `${singular} found`, `${plural} found`)}, run with ${LINE_LIMIT_FLAG} to see them`)

/**
 * Formats what a check found against an empty list or set `want`, as a `found:` row with an item per line. Shows no `-`
 * or `extra:`, because what an item means depends on the check, like an outdated package, which the fix upgrades and
 * doesn't remove. More items than `diffLimits` allows become a note.
 */
export const formatFoundItems = (items: string[], diffLimits: DiffLimits): DetailRows => {
  if (isPastLineLimit(items.length, diffLimits))
    return { kind: "unaligned", rows: [formatManyFoundNote(items.length, "item", "items")] }

  const itemLines = items.map((item) => foundValueElement(item))
  return { kind: "aligned", rows: itemLines.length > 0 ? [formatAlignedRow("found", itemLines)] : [] }
}

/**
 * Formats what a check found against an empty record `want`, as its keys under a `found:` heading, each with its value
 * and no `->`, and a nested value on one line. More lines than `diffLimits` allows become a note that counts the keys.
 */
export const formatFoundRecord = (record: RecordWant, diffLimits: DiffLimits): DetailRows => {
  const keyRows = Object.entries(record).map(([key, value]) => formatKeyRow(key, [foundValueElement(value)]))
  if (keyRows.length === 0) return { kind: "aligned", rows: [] }

  const rows = [formatLabelHeadingRow("found", keyRows)]
  if (isPastLineLimit(countRowLines(rows), diffLimits))
    return { kind: "unaligned", rows: [formatManyFoundNote(keyRows.length, "key", "keys")] }

  return { kind: "aligned", rows }
}
