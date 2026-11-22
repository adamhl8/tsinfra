import { type } from "arktype"

import type { Comparison } from "#core/session/handlers/shared/converge.ts"
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
 * What a set's fix gets: the wanted set, and how the one the check gave differs from it. Takes `want`'s type, which a
 * nested set's items can make a set of numbers, booleans, or `null`.
 */
export interface SetDifference<T = SetWant> {
  /** The set the step wants. */
  want: ReadonlySet<SetItemOf<T>>
  /** What `want` has that the check didn't find, in `want`'s order. */
  missing: SetItemOf<T>[]
  /** What the check found that `want` doesn't have, in the check's order. */
  extra: SetItemOf<T>[]
}

type SetItemOf<T> = T extends ReadonlySet<infer I> ? I : never

/** A set the check gave and the one it wanted, and how they differ. */
export interface SetComparisonValues {
  kind: "set"
  got: string[]
  want: string[]
  missing: string[]
  extra: string[]
}

/** Returns `want`, what it has that `got` doesn't, in `want`'s order, and what `got` has that it doesn't, in `got`'s. */
export const toSetDifference = <I>(got: ReadonlySet<I>, want: ReadonlySet<I>): SetDifference<ReadonlySet<I>> => ({
  want,
  missing: [...want.difference(got)],
  extra: [...got.difference(want)],
})

/**
 * Compares two sets of items, so their order and duplicates don't count. Each side's differences keep that side's
 * order, because a set keeps the order its items were added in.
 */
export const compareSets = (
  gotItems: Iterable<string>,
  wantItems: Iterable<string>,
): Comparison<SetComparisonValues> => {
  const got = [...gotItems]
  const want = [...wantItems]
  const { missing, extra } = toSetDifference(new Set(got), new Set(want))
  const values: SetComparisonValues = { kind: "set", got, want, missing, extra }
  return { inSync: missing.length === 0 && extra.length === 0, values }
}
