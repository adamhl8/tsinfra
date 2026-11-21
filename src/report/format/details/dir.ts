import type { RecordComparisonValues, RecordValue } from "#core/session/handlers/ensure/comparison/record.ts"
import { toModeBits } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { formatMode } from "#report/format/details/shared/attributes.ts"
import { changeElement } from "#report/format/elements/values.ts"

/** Returns a directory's value as the report shows it: its mode in both notations, like a file's, and the rest as is. */
const toShownDirValue = (name: string, value: RecordValue | undefined): RecordValue | undefined =>
  name === "mode" && typeof value === "number" ? formatMode(toModeBits(value)) : value

/** Formats a directory's value that differs as its row, like `mode: rwx------ (700) -> rwxr-x--- (750)`. */
const formatDirRow = (name: string, got: RecordValue | undefined, want: RecordValue): AlignedRow =>
  formatAlignedRow(name, [changeElement(toShownDirValue(name, got), toShownDirValue(name, want))])

/**
 * Formats a directory's rows, one per value that differs, like a file's attribute rows, with `(none)` for a value the
 * host doesn't have, like the mode of a directory that doesn't exist. Labels each row with the value's name, because
 * tsinfra names them. Shows them in `want`'s order, and the host's record only has `want`'s keys, so none is extra.
 */
export const formatDirValues = (values: RecordComparisonValues): AlignedRow[] => {
  const { want, missing, changed } = values
  return Object.keys(want).flatMap((name) => {
    const change = changed[name]
    if (change) return [formatDirRow(name, change.got, change.want)]
    const missingValue = missing[name]
    return missingValue === undefined ? [] : [formatDirRow(name, undefined, missingValue)]
  })
}
