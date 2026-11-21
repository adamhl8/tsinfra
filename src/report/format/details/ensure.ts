import type { EnsureComparisonValues } from "#core/session/handlers/ensure/comparison.ts"
import type { DetailRows } from "#report/format/details.ts"
import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import { formatListDiff } from "#report/format/details/diff/list.ts"
import { formatBooleanWantRows } from "#report/format/details/ensure/boolean.ts"
import { formatFoundItems, formatFoundRecord } from "#report/format/details/ensure/found.ts"
import { formatRecordValues } from "#report/format/details/ensure/record.ts"
import { formatSetValues } from "#report/format/details/ensure/set.ts"
import { formatStringValues } from "#report/format/details/ensure/string.ts"

/**
 * Formats what an `ensure` compared: `got` and `want` rows, a list's diff, a set's `missing` and `extra` rows, a
 * record's row per key, or a note when the lines, items, or keys can't show. An empty list, set, or record `want` shows
 * what the check found instead, because there's nothing to compare it with.
 */
export const formatEnsureValues = (values: EnsureComparisonValues, diffLimits: DiffLimits): DetailRows => {
  if (values.kind === "exit" || values.kind === "boolean")
    return { kind: "aligned", rows: formatBooleanWantRows(values) }
  if (values.kind === "string") return formatStringValues(values.got, values.want, diffLimits)
  if (values.kind === "list") {
    if (values.want.length === 0) return formatFoundItems(values.got, diffLimits)
    return { kind: "unaligned", rows: formatListDiff(values.got, values.want, diffLimits) }
  }
  if (values.kind === "set")
    return values.want.length === 0 ? formatFoundItems(values.got, diffLimits) : formatSetValues(values, diffLimits)

  const isEmptyRecord = Object.keys(values.want).length === 0
  return isEmptyRecord ? formatFoundRecord(values.got, diffLimits) : formatRecordValues(values, diffLimits)
}
