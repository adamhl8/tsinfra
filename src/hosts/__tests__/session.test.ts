import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { attempt, isErr, messageChain } from "ts-explicit-errors"

import type { Host } from "#hosts/host.ts"
import { host } from "#hosts/host.ts"
import { createHostSession } from "#hosts/session.ts"

const doNothing = async () => {
  /* empty */
}

const createSession = (target = "@local") => createHostSession({ name: "a", ...host(target, doNothing) })

/** Reads `cmd` and returns its output, or the thrown error's message chain. */
const readOrMessage = async (h: Host, cmd: string) => {
  const output = await attempt(async () => h.read(cmd))
  return isErr(output) ? messageChain(output) : output
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
    const hostSession = createSession("a.lan")

    expect(await readOrMessage(hostSession.host, "echo hi")).toBe(
      "failed to read 'echo hi' -> target 'a.lan' isn't supported yet (only '@local')",
    )
  })
})
