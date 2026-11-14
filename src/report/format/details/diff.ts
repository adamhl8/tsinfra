import type { StructuredPatchHunk } from "diff"
import { structuredPatch } from "diff"

import { diffGutterElement, diffLineElement, diffRuleElement, noteElement } from "#report/format/elements/elements.ts"
import type { Verbosity } from "#report/verbosity.ts"
import { endWithNewline, getMaxWidth } from "#utils.ts"

/**
 * How far a diff, or a comparison of an `ensure`'s lines, may go before it becomes a note that names the flag that
 * shows it. An unset limit doesn't apply.
 */
export interface DiffLimits {
  /** How long to compute it before giving up. Unset allows `FULL_DIFF_TIMEOUT_MS`. */
  timeoutMs?: number
  /** How many lines it may show, counting a diff's rules between hunks. Unset shows every line. */
  maxLines?: number
}

// Give up quickly below `-vv`, so a value that changed throughout can't stall `plan`.
const QUICK_TIMEOUT_MS = 200
// Hide more than 15 lines below `-v`, so one big change can't push the rest of a plan off the screen.
const MAX_LINES = 15

/** The flag that lifts the line limit, for the notes that suggest it. */
export const LINE_LIMIT_FLAG = "--verbose"
/** The flag that lifts the time limit, for the notes that suggest it. */
export const TIME_LIMIT_FLAG = "-vv"

/** Returns the limits at `verbosity`: the time and the lines below `-v`, the time alone at `-v`, and none from `-vv`. */
export const toDiffLimits = (verbosity: Verbosity): DiffLimits => ({
  ...(verbosity < 2 && { timeoutMs: QUICK_TIMEOUT_MS }),
  ...(verbosity < 1 && { maxLines: MAX_LINES }),
})

// Stop computing a full diff after this long anyway, so a value that's hard to diff can't hang the run.
export const FULL_DIFF_TIMEOUT_MS = 10_000
// Show one unchanged line around each change, so a plan stays short.
const DIFF_CONTEXT_LINES = 1

/** Formats the note in place of a diff that took too long, naming the flag that shows it only when one does. */
const formatSlowDiffNote = (hasTimeLimit: boolean): string =>
  noteElement(`diff took too long to compute${hasTimeLimit ? `, run with ${TIME_LIMIT_FLAG} to see it` : ""}`)

/** Formats the note in place of a diff of `lineCount` lines, which is too long to show. */
const formatLongDiffNote = (lineCount: number): string =>
  noteElement(`long diff (${lineCount} lines), run with ${LINE_LIMIT_FLAG} to see it`)

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
export const formatDiff = (got: string, want: string, diffLimits: DiffLimits): string[] => {
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

  // Draw the rule as wide as the diff's widest line, so it reads as a divider within the diff.
  const ruleWidth = getMaxWidth(hunkLines.flat())
  const rule = diffRuleElement(ruleWidth)
  const diffLines: string[] = []
  for (const [index, lines] of hunkLines.entries()) {
    if (index > 0) diffLines.push(rule)
    diffLines.push(...lines)
  }

  if (diffLimits.maxLines !== undefined && diffLines.length > diffLimits.maxLines)
    return [formatLongDiffNote(diffLines.length)]

  // Frame the diff with a rule above and below, so it stands apart from the lines around it, like a `stderr:` row.
  return [rule, ...diffLines, rule]
}
