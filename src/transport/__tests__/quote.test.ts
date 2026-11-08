import { describe, expect, it } from "bun:test"

import { quoteShellArg } from "#transport/quote.ts"

describe("quoteShellArg", () => {
  it(String.raw`should wrap text in single quotes, and write each single quote as '\''`, () => {
    expect(quoteShellArg("/srv/it's here")).toBe(String.raw`'/srv/it'\''s here'`)
  })
})
