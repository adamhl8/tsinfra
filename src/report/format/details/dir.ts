import type {
  RecordComparisonValues,
  RecordValue,
  RecordWant,
} from "#core/session/handlers/ensure/comparison/record.ts"
import { toModeBits } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import type { DetailRows } from "#report/format/details.ts"
import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import { formatRecordValues } from "#report/format/details/ensure/record.ts"
import { formatMode } from "#report/format/details/shared/attributes.ts"

/** Returns a directory's value as the report shows it: its mode in both notations, like a file's, and the rest as is. */
const toShownDirValue = (key: string, value: RecordValue): RecordValue =>
  key === "mode" && typeof value === "number" ? formatMode(toModeBits(value)) : value

/** Returns `record` with each of its values as the report shows it. */
const toShownDirRecord = (record: RecordWant): Record<string, RecordValue> =>
  Object.fromEntries(
    Object.entries(record).map(([key, value]): [string, RecordValue] => [key, toShownDirValue(key, value)]),
  )

/**
 * Returns a directory's values with each one as the report shows it, so the record formatter prints them as they are.
 * The values compare as data, so the mode is recorded as its bits.
 */
const toShownDirValues = (values: RecordComparisonValues): RecordComparisonValues => {
  const { got, want } = values
  return { ...values, got: toShownDirRecord(got), want: toShownDirRecord(want) }
}

/** Formats a directory's rows, one per key that differs, like a record `want`'s, with its mode like a file's. */
export const formatDirValues = (values: RecordComparisonValues, diffLimits: DiffLimits): DetailRows =>
  formatRecordValues(toShownDirValues(values), diffLimits)
