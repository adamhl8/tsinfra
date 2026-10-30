import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"

import { createSession, getFailureMessage, readOrMessage } from "#__tests__/session.ts"

describe("createHostSession", () => {
  it("should throw the first failure again without running anything once the host has failed", async () => {
    const file = path.join(await makeTempDir("read-"), "ran")
    const hostSession = createSession()
    await readOrMessage(hostSession.host, "exit 1")

    expect(await readOrMessage(hostSession.host, `touch '${file}'`)).toBe(
      "failed to read 'exit 1' -> exited with code 1",
    )
    expect(await Bun.file(file).exists()).toBe(false)
  })

  it("should keep the first failure when calls made at once both fail", async () => {
    const hostSession = createSession()

    await Promise.allSettled([hostSession.host.read("exit 1"), hostSession.host.read("sleep 0.1; exit 2")])

    expect(getFailureMessage(hostSession)).toBe("failed to read 'exit 1' -> exited with code 1")
  })

  it("should fail when the target isn't '@local'", async () => {
    const hostSession = createSession("apply", "a.lan")

    expect(await readOrMessage(hostSession.host, "echo hi")).toBe(
      "failed to read 'echo hi' -> target 'a.lan' isn't supported yet (only '@local')",
    )
  })
})
