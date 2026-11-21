import { diffRuleElement } from "#report/format/elements/diff.ts"
import { noteElement } from "#report/format/elements/messages.ts"
import type { Verbosity } from "#report/verbosity.ts"
import { getMaxWidth } from "#utils.ts"

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

/** Checks whether `lineCount` lines go past the line limit in `diffLimits`, which doesn't apply when it's unset. */
export const isPastLineLimit = (lineCount: number, diffLimits: DiffLimits): boolean =>
  diffLimits.maxLines !== undefined && lineCount > diffLimits.maxLines

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
export const DIFF_CONTEXT_LINES = 1

/** Formats the note in place of a diff that took too long, naming the flag that shows it only when one does. */
export const formatSlowDiffNote = (hasTimeLimit: boolean): string =>
  noteElement(`diff took too long to compute${hasTimeLimit ? `, run with ${TIME_LIMIT_FLAG} to see it` : ""}`)

/** Formats the note in place of a diff of `lineCount` lines, which is too long to show. */
const formatLongDiffNote = (lineCount: number): string =>
  noteElement(`long diff (${lineCount} lines), run with ${LINE_LIMIT_FLAG} to see it`)

/** Returns the dim rule for a diff's formatted hunks. */
const formatDiffRule = (hunkLines: string[][]): string => {
  // Draw the rule as wide as the diff's widest line, so it reads as a divider within the diff.
  const ruleWidth = getMaxWidth(hunkLines.flat())
  return diffRuleElement(ruleWidth)
}

/** Returns a diff's formatted hunks as one diff, with a dim rule between hunks but none around the diff. */
export const formatUnframedDiff = (hunkLines: string[][]): string[] => {
  const rule = formatDiffRule(hunkLines)
  return hunkLines.flatMap((lines, index) => (index > 0 ? [rule, ...lines] : lines))
}

/**
 * Returns a diff's formatted hunks as one diff, with a dim rule between hunks and one above and below. A diff longer
 * than `diffLimits` allows, counting the rules between hunks, becomes a note that names the flag that shows it.
 */
export const formatFramedDiff = (hunkLines: string[][], diffLimits: DiffLimits): string[] => {
  const diffLines = formatUnframedDiff(hunkLines)
  if (isPastLineLimit(diffLines.length, diffLimits)) return [formatLongDiffNote(diffLines.length)]

  // Frame the diff with a rule above and below, so it stands apart from the lines around it, like a `stderr:` row.
  const rule = formatDiffRule(hunkLines)
  return [rule, ...diffLines, rule]
}
