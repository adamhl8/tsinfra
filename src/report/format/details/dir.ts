import type { DetailRows } from "#report/format/details/details.ts"
import type { DiffLimits } from "#report/format/details/diff.ts"
import { formatRecordValues } from "#report/format/details/ensure.ts"
import { formatMode } from "#report/format/details/shared/shared.ts"
import type { RecordComparisonValues, RecordValue } from "#session/session.ts"
import { toModeBits } from "#session/session.ts"

/** Returns a directory's value as the report shows it: its mode in both notations, like a file's, and the rest as is. */
const toShownDirValue = (key: string, value: RecordValue): RecordValue =>
  key === "mode" && typeof value === "number" ? formatMode(toModeBits(value)) : value

/** Returns `record` with each of its values as the report shows it. */
const toShownDirRecord = (record: Record<string, RecordValue>): Record<string, RecordValue> =>
  Object.fromEntries(
    Object.entries(record).map(([key, value]): [string, RecordValue] => [key, toShownDirValue(key, value)]),
  )

/**
 * Returns a directory's values with each one as the report shows it, so the record formatter prints them as they are.
 * The values compare as data, so the mode is recorded as its bits.
 */
const toShownDirValues = (values: RecordComparisonValues): RecordComparisonValues => {
  const { got, want, missing, extra, changed } = values

  const shownChanged = Object.fromEntries(
    Object.entries(changed).map(([key, change]): [string, { got: RecordValue; want: RecordValue }] => [
      key,
      { got: toShownDirValue(key, change.got), want: toShownDirValue(key, change.want) },
    ]),
  )

  return {
    ...values,
    got: toShownDirRecord(got),
    want: toShownDirRecord(want),
    missing: toShownDirRecord(missing),
    extra: toShownDirRecord(extra),
    changed: shownChanged,
  }
}

/** Formats a directory's rows, one per key that differs, like a record `want`'s, with its mode like a file's. */
export const formatDirValues = (values: RecordComparisonValues, diffLimits: DiffLimits): DetailRows =>
  formatRecordValues(toShownDirValues(values), diffLimits)
