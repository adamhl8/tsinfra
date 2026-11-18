import { describe, expect, it } from "bun:test"

import { createSession, readOrMessage } from "#core/__tests__/session.ts"

describe("input with passwordless sudo", () => {
  it("should give the input to a command run with sudo, as root", async () => {
    const { host: h } = await createSession("apply", { sudo: true })

    expect(await readOrMessage(h, "sudo sh -c 'id -u; cat'", { input: "a\nb" })).toBe("0\na\nb")
  })
})
