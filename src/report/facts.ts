import pc from "picocolors"

import { formatDiff } from "#report/diff.ts"
import type { FormatOptions } from "#report/format.ts"
import { styleExitCode, styleGot, styleQuotedValue, styleValue, styleWant } from "#report/styles.ts"
import { getMaxWidth, padToWidth } from "#report/utils.ts"
import type { HostState } from "#session/converge.ts"
import type { Comparison } from "#session/step.ts"

interface Fact {
  label: string
  valueLines: string[]
}

/** Returns a single-line comparison's `got` and `want` as the output shows them. */
const styleGotAndWant = (comparison: Comparison) => {
  if (comparison.kind === "string")
    return { got: styleQuotedValue(comparison.got, styleGot), want: styleQuotedValue(comparison.want, styleWant) }
  if (comparison.kind === "boolean")
    return { got: styleGot(String(comparison.got)), want: styleWant(String(comparison.want)) }

  const want = comparison.want ? "exit code 0" : "a non-zero exit code"
  return { got: styleExitCode(`exit code ${comparison.got}`, styleGot), want: styleExitCode(want, styleWant) }
}

/** Formats labeled facts with their values lined up in one column, and a multi-line value's later lines under its first. */
const formatFacts = (facts: Fact[]) => {
  const valueColumn = getMaxWidth(facts.map(({ label }) => `${label}: `))
  const continuationIndent = " ".repeat(valueColumn)

  return facts.flatMap(({ label, valueLines }) => {
    // Dim the label, so the value is what stands out.
    const labelText = pc.dim(padToWidth(`${label}: `, valueColumn))
    return valueLines.map((valueLine, index) => `${index === 0 ? labelText : continuationIndent}${valueLine}`)
  })
}

const isMultiLine = (text: string) => text.includes("\n")

/**
 * Returns how a comparison differs: a diff for a multi-line string, or `got` and `want` lines otherwise. `extraFacts`
 * follow, lined up with `got` and `want`.
 */
export const formatComparison = (comparison: Comparison, formatOptions: FormatOptions, extraFacts: Fact[] = []) => {
  if (comparison.kind === "string" && (isMultiLine(comparison.got) || isMultiLine(comparison.want)))
    return [...formatDiff(comparison.got, comparison.want, formatOptions), ...formatFacts(extraFacts)]

  const { got, want } = styleGotAndWant(comparison)
  return formatFacts([{ label: "got", valueLines: [got] }, { label: "want", valueLines: [want] }, ...extraFacts])
}

/** Lists what a step found in the host's state when it still differed after the fix. */
export const formatStateFacts = (hostState: HostState, formatOptions: FormatOptions) => {
  const { comparison, commandOutput } = hostState

  // Leave out empty stderr, so a quiet command shows only how the value differs.
  // Style each line of it, so a continuation line starts in the value's color too.
  const stderr = commandOutput?.stderr.trim()
  const extraFacts = stderr
    ? [{ label: "stderr", valueLines: stderr.split("\n").map((stderrLine) => styleValue(stderrLine)) }]
    : []

  return formatComparison(comparison, formatOptions, extraFacts)
}
