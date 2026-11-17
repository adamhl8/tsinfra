import { type } from "arktype"

import type { Comparison } from "#session/handlers/shared/shared.ts"
import { describeType } from "#utils.ts"

/** A set `want` as a script passes it, readonly so a constant works. */
export type SetWant = ReadonlySet<string>

/**
 * A set `want`, which a command's lines or a function's `Set` must match as a set. Checks the items in a narrow,
 * because ArkType has no type for a set of strings.
 */
export const setWantSchema = type
  .instanceOf(Set)
  .narrow((set, ctx) => {
    for (const item of set) {
      if (typeof item !== "string") {
        return ctx.reject({
          expected: "a Set of strings",
          actual: `a Set holding an item of type '${describeType(item)}'`,
        })
      }
    }
    return true
  })
  .as<SetWant>()

/**
 * How a set the check gave differs from the one it wanted. `missing` is what `want` has that the check didn't find, in
 * `want`'s order, and `extra` the reverse, in the check's.
 */
export interface SetDifference {
  missing: string[]
  extra: string[]
}

/** A set the check gave and the one it wanted, and how they differ. */
export interface SetComparisonValues extends SetDifference {
  kind: "set"
  got: string[]
  want: string[]
}

/**
 * Compares two sets of items, so their order and duplicates don't count. Each side's differences keep that side's
 * order, because a set keeps the order its items were added in.
 */
export const compareSets = (gotItems: Iterable<string>, wantItems: Iterable<string>): Comparison => {
  const got = [...gotItems]
  const want = [...wantItems]
  const gotSet = new Set(got)
  const wantSet = new Set(want)
  const missing = [...wantSet.difference(gotSet)]
  const extra = [...gotSet.difference(wantSet)]
  const values: SetComparisonValues = { kind: "set", got, want, missing, extra }
  return { inSync: missing.length === 0 && extra.length === 0, values }
}
