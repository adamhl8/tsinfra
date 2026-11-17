import type { ArrayChange } from "diff"
import { diffArrays } from "diff"

import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import {
  DIFF_CONTEXT_LINES,
  FULL_DIFF_TIMEOUT_MS,
  formatFramedDiff,
  formatSlowDiffNote,
} from "#report/format/details/diff/limits.ts"
import type { ListItemChange } from "#report/format/elements/values.ts"
import { listDiffItemElement } from "#report/format/elements/values.ts"

/** An item of a list diff, and whether it's only on the host, only in `want`, or on both. */
interface ListDiffItem {
  item: string
  itemChange: ListItemChange
}

/** Returns which side a change from `diffArrays` is on. */
const toListItemChange = (change: ArrayChange<string>): ListItemChange => {
  if (change.removed) return "removed"
  if (change.added) return "added"
  return "unchanged"
}

/**
 * Groups a list diff's items into hunks, the way `structuredPatch` does for lines: each changed item, with
 * `DIFF_CONTEXT_LINES` unchanged items on each side, and a new hunk where unchanged items are skipped.
 */
const toListDiffHunks = (diffItems: ListDiffItem[]): ListDiffItem[][] => {
  const isNearChange = (index: number) =>
    diffItems
      .slice(Math.max(0, index - DIFF_CONTEXT_LINES), index + DIFF_CONTEXT_LINES + 1)
      .some(({ itemChange }) => itemChange !== "unchanged")

  const hunks: ListDiffItem[][] = []
  let hunk: ListDiffItem[] = []
  for (const [index, diffItem] of diffItems.entries()) {
    if (isNearChange(index)) hunk.push(diffItem)
    else if (hunk.length > 0) {
      hunks.push(hunk)
      hunk = []
    }
  }
  if (hunk.length > 0) hunks.push(hunk)
  return hunks
}

/**
 * Returns an item diff from `got` to `want`, each item after its `-`, `+`, or space, with a dim rule between hunks. It
 * diffs items, not lines, so an item with a newline in it stays one item. A diff that goes past one of `diffLimits`
 * becomes a note that names the flag that shows it.
 */
export const formatListDiff = (got: string[], want: string[], diffLimits: DiffLimits): string[] => {
  const timeout = diffLimits.timeoutMs ?? FULL_DIFF_TIMEOUT_MS
  const changes = diffArrays(got, want, { timeout })

  if (changes === undefined) return [formatSlowDiffNote(diffLimits.timeoutMs !== undefined)]

  const diffItems = changes.flatMap((change) =>
    change.value.map((item) => ({ item, itemChange: toListItemChange(change) })),
  )
  const hunkLines = toListDiffHunks(diffItems).map((hunk) =>
    hunk.map(({ item, itemChange }) => listDiffItemElement(itemChange, item)),
  )
  return formatFramedDiff(hunkLines, diffLimits)
}
