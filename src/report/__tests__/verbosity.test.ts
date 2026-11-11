import { describe, expect, it } from "bun:test"

import type { Verbosity } from "#report/verbosity.ts"
import { toVerbosity } from "#report/verbosity.ts"

describe("toVerbosity", () => {
  it.each<[number, Verbosity]>([
    [0, 0],
    [1, 1],
    [3, 3],
  ])("should give %d flags the level %d", (flagCount, verbosity) => {
    expect(toVerbosity(flagCount)).toBe(verbosity)
  })

  it("should count more than three flags as 3", () => {
    expect(toVerbosity(4)).toBe(3)
  })
})
