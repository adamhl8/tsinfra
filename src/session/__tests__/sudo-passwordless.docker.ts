import { describe, expect, it } from "bun:test"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { createSession, readOrMessage } from "#__tests__/session.ts"

const ASKPASS_HELPER_PATH = path.join(os.homedir(), ".tsinfra", "askpass.sh")

describe("a user with passwordless sudo", () => {
  it("should pass preflight with sudo: true", async () => {
    const { host: h } = await createSession("plan", { sudo: true })

    expect(await readOrMessage(h, "sudo id -u")).toBe("0")
  })

  it("should pass preflight with any password from host(), because sudo never asks for it", async () => {
    const { host: h } = await createSession("plan", { sudo: { password: "unused" } })

    expect(existsSync(ASKPASS_HELPER_PATH)).toBe(true)
    expect(await readOrMessage(h, "sudo id -u")).toBe("0")
  })
})
