import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"

import {
  createSession,
  ensureOrMessage,
  ensureValueOrMessage,
  getFailureMessage,
  readOrMessage,
  runOrMessage,
} from "#__tests__/session.ts"

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

  it("should keep the first failure when a later one doesn't wrap it", async () => {
    const hostSession = createSession()
    const { host: h } = hostSession

    await Promise.allSettled([
      h.ensure("First", { check: "sleep 0.1; false", fix: "exit 1" }),
      h.ensure("Second", { check: "true", fix: "true" }),
    ])

    expect(getFailureMessage(hostSession)).toBe("'ensure' can't run while step 'First' is running")
  })

  it("should fail when the target isn't '@local'", async () => {
    const hostSession = createSession("apply", "a.lan")

    expect(await readOrMessage(hostSession.host, "echo hi")).toBe(
      "failed to read 'echo hi' -> target 'a.lan' isn't supported yet (only '@local')",
    )
  })
})

describe("h inside a step", () => {
  it("should fail the host when a check function calls h.read", async () => {
    const hostSession = createSession()
    const { host: h } = hostSession
    const message = "failed to check step 'Make marker' -> 'read' can't run while step 'Make marker' is running"
    const result = await ensureOrMessage(h, { check: async () => (await h.read("true")) === "", fix: "true" })

    expect(result).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should fail the host when a read function calls h.ensureValue", async () => {
    const { host: h } = createSession()
    const result = await ensureValueOrMessage(h, {
      read: async () => {
        await h.ensureValue("Inner", { read: "echo v", want: "v", fix: "true" })
        return "v"
      },
      want: "v",
      fix: "true",
    })

    expect(result).toBe(
      "failed to check step 'Make marker' -> 'ensureValue' can't run while step 'Make marker' is running",
    )
  })

  it("should fail the host when a fix function calls h.ensure", async () => {
    const { host: h } = createSession()
    const result = await ensureOrMessage(h, {
      check: "false",
      fix: async () => {
        await h.ensure("Inner", { check: "true", fix: "true" })
      },
    })

    expect(result).toBe(
      "failed to run the fix for step 'Make marker' -> 'ensure' can't run while step 'Make marker' is running",
    )
  })

  it("should fail the host when a run function calls h.run", async () => {
    const { host: h } = createSession()
    const result = await runOrMessage(
      h,
      async () => {
        await h.run("Inner", "true", { when: true })
      },
      { when: true },
    )

    expect(result).toBe("failed to run step 'Make marker' -> 'run' can't run while step 'Make marker' is running")
  })

  it("should fail the host when steps run at once with Promise.all", async () => {
    const hostSession = createSession()
    const { host: h } = hostSession

    await Promise.allSettled([
      h.ensure("First", { check: "sleep 0.1", fix: "true" }),
      h.ensure("Second", { check: "true", fix: "true" }),
    ])

    expect(getFailureMessage(hostSession)).toBe("'ensure' can't run while step 'First' is running")
  })

  it("should name a running read by its command", async () => {
    const hostSession = createSession()
    const { host: h } = hostSession

    await Promise.allSettled([h.read("sleep 0.1"), h.ensure("Second", { check: "true", fix: "true" })])

    expect(getFailureMessage(hostSession)).toBe("'ensure' can't run while read 'sleep 0.1' is running")
  })

  it("should fail the host when h.read runs alongside a step", async () => {
    const hostSession = createSession()
    const { host: h } = hostSession

    await Promise.allSettled([h.ensure("First", { check: "sleep 0.1", fix: "true" }), h.read("true")])

    expect(getFailureMessage(hostSession)).toBe("'read' can't run while step 'First' is running")
  })

  it("should allow calls on h again once a step finishes", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "true", fix: "true" })).toStrictEqual({ changed: false })
    expect(await ensureOrMessage(h, { check: "true", fix: "true" })).toStrictEqual({ changed: false })
    expect(await readOrMessage(h, "echo hi")).toBe("hi")
  })
})
