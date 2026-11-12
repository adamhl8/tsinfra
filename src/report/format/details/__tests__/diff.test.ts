import { describe, expect, it } from "bun:test"

import { DEFAULT_DIFF_LIMITS, formatDiff } from "#report/format/details/diff.ts"

const numberedLines = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`).join("\n")

describe("formatDiff", () => {
  it("should show a note, not a diff, when the diff takes too long", () => {
    expect(formatDiff(numberedLines("a", 20_000), numberedLines("b", 20_000), DEFAULT_DIFF_LIMITS)).toStrictEqual([
      "diff took too long to compute, run with --verbose to see it",
    ])
  })

  it("should hide a diff longer than 15 lines, and say how long it is", () => {
    expect(formatDiff(numberedLines("a", 10), numberedLines("b", 10), DEFAULT_DIFF_LIMITS)).toStrictEqual([
      "long diff (20 lines), run with --verbose to see it",
    ])
  })

  it("should show a long diff in full without limits, framed by a rule above and below", () => {
    const diffLines = formatDiff(numberedLines("a", 10), numberedLines("b", 10), undefined)
    const rule = "─".repeat(6)

    expect(diffLines).toHaveLength(22)
    expect([diffLines[0], diffLines.slice(10, 12), diffLines.at(-1)]).toStrictEqual([rule, ["   -a9", " 1 +b0"], rule])
  })
})
