import type { Detail } from "#report/host-block/host-block.ts"
import type { Verbosity } from "#report/verbosity.ts"
import type { ComparisonValues, FileComparisonValues } from "#session/session.ts"

/** Returns how a file differs: a diff when its content is text, then its comparison values. */
const toFileComparisonDetails = (values: FileComparisonValues, from: Verbosity): Detail[] => {
  const { content } = values
  const diffDetails: Detail[] =
    content.kind === "text" ? [{ kind: "diff", got: content.got, want: content.want, from }] : []
  return [...diffDetails, { kind: "fileComparisonValues", values, from }]
}

/**
 * Returns how a value differs, for a step that changes it or a step that failed to. It takes the level its caller
 * decides, because the same values show from 0 on a change and from 1 before a failed fix.
 */
export const toComparisonValuesDetails = (values: ComparisonValues, from: Verbosity): Detail[] => {
  if (values.kind === "file") return toFileComparisonDetails(values, from)
  if (values.kind === "link") return [{ kind: "linkComparisonValues", values, from }]
  return [{ kind: "ensureComparisonValues", values, from }]
}
