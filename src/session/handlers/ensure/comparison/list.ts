import { type } from "arktype"

import type { Comparison } from "#session/handlers/shared/shared.ts"
import { splitNonEmptyLines } from "#utils.ts"

/** A list `want`, which a command's lines or a function's array must match as a set. */
export const listWantSchema = type("string[]")
type ListItems = typeof listWantSchema.infer

/** A list `want` as a script passes it, readonly so a constant or `as const` works, which the schema can't express. */
export type ListWant = Readonly<ListItems>

/**
 * How a list the check gave differs from the one it wanted. `missing` is what `want` has that the check didn't find, in
 * `want`'s order, and `extra` the reverse, in the check's.
 */
export interface ListDifference {
  missing: ListItems
  extra: ListItems
}

/** A list the check gave and the one it wanted, and how they differ. */
export interface ListComparisonValues extends ListDifference {
  kind: "list"
  got: ListItems
  want: ListItems
}

/** Reads a command's stdout as a list of items, one per line, leaving out the blank lines. */
export const toListItems = (stdout: string): string[] => splitNonEmptyLines(stdout)

/**
 * Compares two lists as sets, so their order and duplicates don't count. Each side's differences keep that side's
 * order, because a set keeps the order its items were added in.
 */
export const compareLists = (gotItems: ListWant, wantItems: ListWant): Comparison => {
  const gotSet = new Set(gotItems)
  const wantSet = new Set(wantItems)
  const missing = [...wantSet.difference(gotSet)]
  const extra = [...gotSet.difference(wantSet)]
  const values: ListComparisonValues = { kind: "list", got: [...gotItems], want: [...wantItems], missing, extra }
  return { inSync: missing.length === 0 && extra.length === 0, values }
}
