import type { EnsureComparisonValues } from "#core/session/handlers/ensure/comparison.ts"
import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { gotValueElement, wantValueElement } from "#report/format/elements/values.ts"

type BooleanWantValues = Extract<EnsureComparisonValues, { kind: "exit" | "boolean" }>

// Describe an exit code in words, because a bare `1` would be hard to read.
const describeExitCode = (exitCode: number) => `exit code ${exitCode}`
const describeWantedExit = (wantsZero: boolean) => (wantsZero ? "exit code 0" : "a non-zero exit code")

/** Formats the `got` and `want` rows of a boolean `want`: a command's exit code, or a check function's boolean. */
export const formatBooleanWantRows = (values: BooleanWantValues): AlignedRow[] => {
  const got = values.kind === "exit" ? gotValueElement(values.got, describeExitCode) : gotValueElement(values.got)
  const want =
    values.kind === "exit" ? wantValueElement(values.want, describeWantedExit) : wantValueElement(values.want)
  return [formatAlignedRow("got", [got]), formatAlignedRow("want", [want])]
}
