import type { StructuredPatchHunk } from "diff"
import { structuredPatch } from "diff"

import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import {
  DIFF_CONTEXT_LINES,
  FULL_DIFF_TIMEOUT_MS,
  formatFramedDiff,
  formatSlowDiffNote,
} from "#report/format/details/diff/limits.ts"
import { diffGutterElement, diffLineElement } from "#report/format/elements/diff.ts"
import { endWithNewline } from "#utils.ts"

/**
 * Returns a hunk's lines, each after a gutter with its line number in `want`. A removed line gets a blank gutter,
 * because it isn't in `want`.
 */
const formatHunk = (hunk: StructuredPatchHunk, gutterWidth: number): string[] => {
  let lineNumber = hunk.newStart
  return hunk.lines.map((diffLine) => {
    if (diffLine.startsWith("-")) return `${" ".repeat(gutterWidth)} ${diffLineElement(diffLine)}`

    const gutter = diffGutterElement(lineNumber, gutterWidth)
    lineNumber += 1
    return `${gutter} ${diffLineElement(diffLine)}`
  })
}

/**
 * Returns a line diff from `got` to `want`, numbered by `want`'s lines, with a dim rule between hunks. A diff that goes
 * past one of `diffLimits` becomes a note that names the flag that shows it.
 */
export const formatFileDiff = (got: string, want: string, diffLimits: DiffLimits): string[] => {
  const timeout = diffLimits.timeoutMs ?? FULL_DIFF_TIMEOUT_MS
  // End both sides with a newline, so jsdiff never adds its "No newline at end of file" line.
  const patch = structuredPatch("", "", endWithNewline(got), endWithNewline(want), undefined, undefined, {
    context: DIFF_CONTEXT_LINES,
    timeout,
  })

  if (patch === undefined) return [formatSlowDiffNote(diffLimits.timeoutMs !== undefined)]

  // Pad every gutter to the widest line number, so the diff lines start in one column.
  const lastLineNumbers = patch.hunks.map(({ newStart, newLines }) => newStart + newLines - 1)
  const gutterWidth = String(Math.max(1, ...lastLineNumbers)).length
  const hunkLines = patch.hunks.map((hunk) => formatHunk(hunk, gutterWidth))

  return formatFramedDiff(hunkLines, diffLimits)
}
