import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"

import { createSession, ensureOrMessage, getFailureMessage, throwBoom } from "#__tests__/session.ts"

/** Returns a path in a new temp dir, plus a step that creates a file there. */
const createMarkerStep = async () => {
  const marker = path.join(await makeTempDir("step-"), "marker")
  return { marker, options: { check: `test -f '${marker}'`, fix: `touch '${marker}'` } }
}

describe("h.ensure", () => {
  it("should return ok without running the fix when the check passes", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "true", fix: "exit 1" })).toStrictEqual({ changed: false })
  })

  it("should run the fix in apply and return changed", async () => {
    const { marker, options } = await createMarkerStep()
    const { host: h } = createSession("apply")

    expect(await ensureOrMessage(h, options)).toStrictEqual({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(true)
  })

  it("should return changed in plan without running the fix", async () => {
    const { marker, options } = await createMarkerStep()
    const { host: h } = createSession("plan")

    expect(await ensureOrMessage(h, options)).toStrictEqual({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  it("should fail the host when the fix fails", async () => {
    const hostSession = createSession()
    const message = "failed to run the fix for step 'Make marker' -> exited with code 2: nope"

    expect(await ensureOrMessage(hostSession.host, { check: "false", fix: "echo nope >&2; exit 2" })).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should fail the host when the check still fails after the fix", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "echo missing >&2; false", fix: "true" })).toBe(
      "the check for step 'Make marker' still fails after the fix\n  exited with code 1: missing",
    )
  })

  it("should accept a function check that uses h.read", async () => {
    const { host: h } = createSession()
    const check = async () => (await h.read("echo yes")) === "yes"

    expect(await ensureOrMessage(h, { check, fix: "exit 1" })).toStrictEqual({ changed: false })
  })

  it("should fail the host with the step's name when a function check throws", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: throwBoom, fix: "true" })).toBe(
      "failed to check step 'Make marker' -> boom",
    )
  })

  it("should name the step when a read inside a function check fails", async () => {
    const hostSession = createSession()
    const check = async () => (await hostSession.host.read("exit 1")) === ""
    const message = "failed to check step 'Make marker' -> failed to read 'exit 1' -> exited with code 1"

    expect(await ensureOrMessage(hostSession.host, { check, fix: "true" })).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })
})
