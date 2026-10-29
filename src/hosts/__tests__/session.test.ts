import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { attempt, isErr, messageChain } from "ts-explicit-errors"

import type { Host, Mode, StepOptions } from "#hosts/host.ts"
import { host } from "#hosts/host.ts"
import { createHostSession } from "#hosts/session.ts"

const doNothing = async () => {
  /* empty */
}

const createSession = (mode: Mode = "apply", target = "@local") =>
  createHostSession({ name: "a", ...host(target, doNothing) }, mode)

/** Reads `cmd` and returns its output, or the thrown error's message chain. */
const readOrMessage = async (h: Host, cmd: string) => {
  const output = await attempt(async () => h.read(cmd))
  return isErr(output) ? messageChain(output) : output
}

/** Runs a step and returns its result, or the thrown error's message chain. */
const stepOrMessage = async (h: Host, options: StepOptions) => {
  const result = await attempt(async () => h.step("Make marker", options))
  return isErr(result) ? messageChain(result) : result
}

/** Returns a path in a new temp dir, plus a step that creates a file there. */
const createMarkerStep = async () => {
  const marker = path.join(await makeTempDir("step-"), "marker")
  return { marker, options: { check: `test -f '${marker}'`, fix: `touch '${marker}'` } }
}

const throwBoom = () => {
  throw new Error("boom")
}

/** Returns the message chain of the host's recorded failure, if any. */
const getFailureMessage = ({ getFailure }: ReturnType<typeof createSession>) => {
  const failure = getFailure()
  return failure && messageChain(failure)
}

describe("h.read", () => {
  it("should return stdout without trailing newlines", async () => {
    const hostSession = createSession()

    expect(await hostSession.host.read(String.raw`printf 'a\nb\n\n'`)).toBe("a\nb")
  })

  it("should throw and record a failure with the exit code and stderr when the command fails", async () => {
    const hostSession = createSession()
    const message = "failed to read 'echo oops >&2; exit 3' -> exited with code 3: oops"

    expect(await readOrMessage(hostSession.host, "echo oops >&2; exit 3")).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should leave stderr out of the failure when it's empty", async () => {
    const hostSession = createSession()

    expect(await readOrMessage(hostSession.host, "exit 1")).toBe("failed to read 'exit 1' -> exited with code 1")
  })

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

describe("h.step", () => {
  it("should return ok without running the fix when the check passes", async () => {
    const { host: h } = createSession()

    expect(await stepOrMessage(h, { check: "true", fix: "exit 1" })).toStrictEqual({ changed: false })
  })

  it("should run the fix in apply and return changed", async () => {
    const { marker, options } = await createMarkerStep()
    const { host: h } = createSession("apply")

    expect(await stepOrMessage(h, options)).toStrictEqual({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(true)
  })

  it("should return changed in plan without running the fix", async () => {
    const { marker, options } = await createMarkerStep()
    const { host: h } = createSession("plan")

    expect(await stepOrMessage(h, options)).toStrictEqual({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  it("should fail the host when the fix fails", async () => {
    const hostSession = createSession()
    const message = "failed to run the fix for step 'Make marker' -> exited with code 2: nope"

    expect(await stepOrMessage(hostSession.host, { check: "false", fix: "echo nope >&2; exit 2" })).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should fail the host when the check still fails after the fix", async () => {
    const { host: h } = createSession()

    expect(await stepOrMessage(h, { check: "echo missing >&2; false", fix: "true" })).toBe(
      "the check for step 'Make marker' still fails after the fix: missing",
    )
  })

  it("should accept a function check that uses h.read", async () => {
    const { host: h } = createSession()
    const check = async () => (await h.read("echo yes")) === "yes"

    expect(await stepOrMessage(h, { check, fix: "exit 1" })).toStrictEqual({ changed: false })
  })

  it("should fail the host with the step's name when a function check throws", async () => {
    const { host: h } = createSession()

    expect(await stepOrMessage(h, { check: throwBoom, fix: "true" })).toBe("failed to check step 'Make marker' -> boom")
  })

  it("should name the step when a read inside a function check fails", async () => {
    const hostSession = createSession()
    const check = async () => (await hostSession.host.read("exit 1")) === ""
    const message = "failed to check step 'Make marker' -> failed to read 'exit 1' -> exited with code 1"

    expect(await stepOrMessage(hostSession.host, { check, fix: "true" })).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })
})
