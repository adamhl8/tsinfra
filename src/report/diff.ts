import type { StructuredPatchHunk } from "diff"
import { structuredPatch } from "diff"
import pc from "picocolors"

import { getMaxWidth } from "#report/utils.ts"

// Show one unchanged line around each change, so a plan stays short.
const DIFF_CONTEXT_LINES = 1
// Give up quickly by default, so a value that changed throughout can't stall `plan`.
const DIFF_TIMEOUT_MS = 200
const VERBOSE_DIFF_TIMEOUT_MS = 10_000
// Hide a diff longer than this, rules included, so one big change can't push the rest of a plan off the screen.
const MAX_DIFF_LINES = 15

const formatNote = (note: string) => pc.dim(pc.italic(note))

// Leave the unchanged lines in the terminal's own text color, which reads in any theme.
const styleDiffLine = (diffLine: string) => {
  if (diffLine.startsWith("-")) return pc.red(diffLine)
  if (diffLine.startsWith("+")) return pc.green(diffLine)
  return diffLine
}

/**
 * Returns a hunk's lines, each after a gutter with its line number in `want`. A removed line gets a blank gutter,
 * because it isn't in `want`.
 */
const numberHunkLines = (hunk: StructuredPatchHunk, gutterWidth: number) => {
  let lineNumber = hunk.newStart
  return hunk.lines.map((diffLine) => {
    if (diffLine.startsWith("-")) return `${" ".repeat(gutterWidth)} ${styleDiffLine(diffLine)}`

    const gutter = pc.dim(String(lineNumber).padStart(gutterWidth))
    lineNumber += 1
    return `${gutter} ${styleDiffLine(diffLine)}`
  })
}

/**
 * Returns a line diff from `got` to `want`, numbered by `want`'s lines, with a dim rule between hunks. Without
 * `verbose`, a diff that is too long to show, or that takes too long to compute, becomes a note that suggests
 * `--verbose`.
 */
export const formatDiff = (got: string, want: string, verbose: boolean): string[] => {
  // End both sides with a newline, so jsdiff never adds its "No newline at end of file" line.
  const timeout = verbose ? VERBOSE_DIFF_TIMEOUT_MS : DIFF_TIMEOUT_MS
  const patch = structuredPatch("", "", `${got}\n`, `${want}\n`, undefined, undefined, {
    context: DIFF_CONTEXT_LINES,
    timeout,
  })

  if (patch === undefined) {
    if (verbose) return [formatNote("diff took too long to compute")]
    return [formatNote("diff took too long to compute, run with --verbose to see it")]
  }

  // Pad every gutter to the widest line number, so the diff lines start in one column.
  const lastLineNumbers = patch.hunks.map(({ newStart, newLines }) => newStart + newLines - 1)
  const gutterWidth = String(Math.max(1, ...lastLineNumbers)).length
  const hunkLines = patch.hunks.map((hunk) => numberHunkLines(hunk, gutterWidth))

  // Draw the rule as wide as the diff's widest line, so it reads as a divider within the diff.
  const ruleWidth = getMaxWidth(hunkLines.flat())
  const rule = pc.dim("─".repeat(ruleWidth))
  const diffLines: string[] = []
  for (const [index, lines] of hunkLines.entries()) {
    if (index > 0) diffLines.push(rule)
    diffLines.push(...lines)
  }

  if (diffLines.length > MAX_DIFF_LINES && !verbose)
    return [formatNote(`long diff (${diffLines.length} lines), run with --verbose to see it`)]

  return diffLines
}
