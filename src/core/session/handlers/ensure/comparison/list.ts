import { type } from "arktype"
import { deepEquals } from "bun"

import type { Comparison } from "#core/session/handlers/shared/converge.ts"
import { splitNonEmptyLines } from "#utils.ts"

/** A list `want`, which a command's lines or a function's array must match in order. */
export const listWantSchema = type("string[]")
type ListItems = typeof listWantSchema.infer

/** A list `want` as a script passes it, readonly so a constant or `as const` works, which the schema can't express. */
export type ListWant = Readonly<ListItems>

/** What a list's fix gets: the list the check gave, because `missing` and `extra` can't describe a reorder. */
export interface ListDifference {
  got: ListItems
}

/** A list the check gave and the one it wanted. */
export interface ListComparisonValues extends ListDifference {
  kind: "list"
  want: ListItems
}

/** Reads a command's stdout as a list of items, one per line, leaving out the blank lines. */
export const toListItems = (stdout: string): string[] => splitNonEmptyLines(stdout)

/** Compares two lists in order, so they match only with the same items in the same order, duplicates included. */
export const compareLists = (gotItems: ListWant, wantItems: ListWant): Comparison => {
  const values: ListComparisonValues = { kind: "list", got: [...gotItems], want: [...wantItems] }
  return { inSync: deepEquals(gotItems, wantItems), values }
}
