import type { Detail } from "#report/host-block.ts"
import type { ComparisonValues, EnsureComparisonValues, FileComparisonValues } from "#session/session.ts"
import { isMultiLine } from "#utils.ts"

/** Returns how a file differs: a diff when its content is text, then its comparison values. */
const toFileComparisonDetails = (values: FileComparisonValues): Detail[] => {
  const { content } = values
  const diffDetails: Detail[] = content.kind === "text" ? [{ kind: "diff", got: content.got, want: content.want }] : []
  return [...diffDetails, { kind: "fileComparisonValues", values }]
}

/** Returns how a check's answer differs: a diff for a multi-line string, or its comparison values otherwise. */
const toEnsureComparisonDetails = (values: EnsureComparisonValues): Detail[] => {
  const isMultiLineString = values.kind === "string" && (isMultiLine(values.got) || isMultiLine(values.want))
  if (isMultiLineString) return [{ kind: "diff", got: values.got, want: values.want }]
  return [{ kind: "ensureComparisonValues", values }]
}

/** Returns how a value differs, for a step that changes it or a step that failed to. */
export const toComparisonValuesDetails = (values: ComparisonValues): Detail[] => {
  if (values.kind === "file") return toFileComparisonDetails(values)
  if (values.kind === "link") return [{ kind: "linkComparisonValues", values }]
  return toEnsureComparisonDetails(values)
}
