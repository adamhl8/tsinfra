import type { DetailRows } from "#report/format/details/details.ts"
import type { DiffLimits } from "#report/format/details/diff/diff.ts"
import { formatListDiff } from "#report/format/details/diff/diff.ts"
import { formatBooleanWantRows } from "#report/format/details/ensure/boolean.ts"
import { formatRecordValues } from "#report/format/details/ensure/record.ts"
import { formatSetValues } from "#report/format/details/ensure/set.ts"
import { formatStringValues } from "#report/format/details/ensure/string.ts"
import type { EnsureComparisonValues } from "#session/session.ts"

export { formatRecordValues } from "#report/format/details/ensure/record.ts"

/**
 * Formats what an `ensure` compared: `got` and `want` rows, a list's diff, a set's `missing` and `extra` rows, a
 * record's row per key, or a note when the lines, items, or keys can't show.
 */
export const formatEnsureValues = (values: EnsureComparisonValues, diffLimits: DiffLimits): DetailRows => {
  if (values.kind === "exit" || values.kind === "boolean")
    return { kind: "aligned", rows: formatBooleanWantRows(values) }
  if (values.kind === "string") return formatStringValues(values.got, values.want, diffLimits)
  if (values.kind === "list") return { kind: "unaligned", rows: formatListDiff(values.got, values.want, diffLimits) }
  if (values.kind === "set") return formatSetValues(values, diffLimits)
  return formatRecordValues(values, diffLimits)
}
