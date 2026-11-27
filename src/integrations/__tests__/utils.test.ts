import { describe, expect, it } from "bun:test"

import { attempt, isErr } from "ts-explicit-errors"

import { createSessionWithFacts } from "#core/__tests__/session.ts"
import { assertPlatform } from "#integrations/utils.ts"

describe("assertPlatform", () => {
  it("should pass on a host on the platform", async () => {
    const { host: h } = await createSessionWithFacts("plan", { platform: "darwin" })

    expect(() => {
      assertPlatform(h, "darwin", "fileHandlers")
    }).not.toThrow()
  })

  it("should throw on a host on another platform, naming the integration", async () => {
    const { host: h } = await createSessionWithFacts("plan", { platform: "linux" })
    const result = attempt(() => {
      assertPlatform(h, "darwin", "fileHandlers")
    })

    expect(isErr(result) ? result.message : result).toBe(
      "The 'fileHandlers' integration needs a 'darwin' host, but this host is 'linux'",
    )
  })
})
