import type { StructuredPatchHunk } from "diff"
import { structuredPatch } from "diff"

import { styleDiffFrame, styleGot, styleNote, styleWant } from "#styles.ts"
import { endWithNewline, getMaxWidth } from "#utils.ts"

/** How far a diff may go before it becomes a note that suggests `--verbose`. */
export interface DiffLimits {
  /** How long to compute the diff before giving up. */
  timeoutMs: number
  /** How many lines the diff may show, counting the rules between hunks. */
  maxLines: number
}

// Give up quickly by default, so a value that changed throughout can't stall `plan`.
// Hide a diff longer than 15 lines, so one big change can't push the rest of a plan off the screen.
export const DEFAULT_DIFF_LIMITS: DiffLimits = { timeoutMs: 200, maxLines: 15 }

// Stop computing a full diff after this long anyway, so a value that's hard to diff can't hang the run.
const FULL_DIFF_TIMEOUT_MS = 10_000
// Show one unchanged line around each change, so a plan stays short.
const DIFF_CONTEXT_LINES = 1
const VERBOSE_HINT = ", run with --verbose to see it"
// Draw a rule with a box-drawing line, so it reads as a divider, not as text.
const HUNK_RULE_CHAR = "─"

// Style a removed line like `got` and an added one like `want`, because they are the two sides of the same comparison.
// Leave the unchanged lines in the terminal's own text color, which reads in any theme.
const styleDiffLine = (diffLine: string): string => {
  if (diffLine.startsWith("-")) return styleGot(diffLine)
  if (diffLine.startsWith("+")) return styleWant(diffLine)
  return diffLine
}

/**
 * Returns a hunk's lines, each after a gutter with its line number in `want`. A removed line gets a blank gutter,
 * because it isn't in `want`.
 */
const formatHunk = (hunk: StructuredPatchHunk, gutterWidth: number): string[] => {
  let lineNumber = hunk.newStart
  return hunk.lines.map((diffLine) => {
    if (diffLine.startsWith("-")) return `${" ".repeat(gutterWidth)} ${styleDiffLine(diffLine)}`

    const gutter = styleDiffFrame(String(lineNumber).padStart(gutterWidth))
    lineNumber += 1
    return `${gutter} ${styleDiffLine(diffLine)}`
  })
}

/**
 * Returns a line diff from `got` to `want`, numbered by `want`'s lines, with a dim rule between hunks. With
 * `diffLimits`, a diff that takes too long to compute, or is too long to show, becomes a note that suggests
 * `--verbose`. Without them, the diff shows in full.
 */
export const formatDiff = (got: string, want: string, diffLimits: DiffLimits | undefined): string[] => {
  const timeout = diffLimits?.timeoutMs ?? FULL_DIFF_TIMEOUT_MS
  // End both sides with a newline, so jsdiff never adds its "No newline at end of file" line.
  const patch = structuredPatch("", "", endWithNewline(got), endWithNewline(want), undefined, undefined, {
    context: DIFF_CONTEXT_LINES,
    timeout,
  })

  // Suggest `--verbose` only under limits, because without them there's nothing more to show.
  const verboseHint = diffLimits ? VERBOSE_HINT : ""
  if (patch === undefined) return [styleNote(`diff took too long to compute${verboseHint}`)]

  // Pad every gutter to the widest line number, so the diff lines start in one column.
  const lastLineNumbers = patch.hunks.map(({ newStart, newLines }) => newStart + newLines - 1)
  const gutterWidth = String(Math.max(1, ...lastLineNumbers)).length
  const hunkLines = patch.hunks.map((hunk) => formatHunk(hunk, gutterWidth))

  // Draw the rule as wide as the diff's widest line, so it reads as a divider within the diff.
  const ruleWidth = getMaxWidth(hunkLines.flat())
  const rule = styleDiffFrame(HUNK_RULE_CHAR.repeat(ruleWidth))
  const diffLines: string[] = []
  for (const [index, lines] of hunkLines.entries()) {
    if (index > 0) diffLines.push(rule)
    diffLines.push(...lines)
  }

  if (diffLimits && diffLines.length > diffLimits.maxLines)
    return [styleNote(`long diff (${diffLines.length} lines)${VERBOSE_HINT}`)]

  // Frame the diff with a rule above and below, so it stands apart from the lines around it, like a `stderr:` row.
  return [rule, ...diffLines, rule]
}
