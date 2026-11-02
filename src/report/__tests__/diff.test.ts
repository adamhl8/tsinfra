import { describe, expect, it } from "bun:test"

import { formatDiff } from "#report/diff.ts"

const numberedLines = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`).join("\n")

describe("formatDiff", () => {
  it("should show a note, not a diff, when the diff takes too long", () => {
    expect(formatDiff(numberedLines("a", 20_000), numberedLines("b", 20_000), false)).toStrictEqual([
      "diff took too long to compute, run with --verbose to see it",
    ])
  })

  it("should hide a diff longer than 15 lines, and say how long it is", () => {
    expect(formatDiff(numberedLines("a", 10), numberedLines("b", 10), false)).toStrictEqual([
      "long diff (20 lines), run with --verbose to see it",
    ])
  })

  it("should show a long diff with --verbose", () => {
    const diffLines = formatDiff(numberedLines("a", 10), numberedLines("b", 10), true)

    expect(diffLines).toHaveLength(20)
    expect(diffLines.slice(9, 11)).toStrictEqual(["   -a9", " 1 +b0"])
  })
})
