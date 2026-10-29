import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { attempt, isErr, messageChain } from "ts-explicit-errors"

import { createHostContext } from "#hosts/context.ts"
import type { Host } from "#hosts/host.ts"
import { host } from "#hosts/host.ts"

const doNothing = async () => {
  /* empty */
}

const createContext = (target = "@local") => createHostContext({ name: "a", file: "", ...host(target, doNothing) })

/** Reads `cmd` and returns its output, or the thrown error's message chain. */
const readOrMessage = async (h: Host, cmd: string) => {
  const output = await attempt(async () => h.read(cmd))
  return isErr(output) ? messageChain(output) : output
}

/** Returns the message chain of the host's recorded failure, if any. */
const getFailureMessage = ({ getFailure }: ReturnType<typeof createContext>) => {
  const failure = getFailure()
  return failure && messageChain(failure)
}

describe("h.read", () => {
  it("should return stdout without trailing newlines", async () => {
    const { h } = createContext()

    expect(await h.read(String.raw`printf 'a\nb\n\n'`)).toBe("a\nb")
  })

  it("should throw and record a failure with the exit code and stderr when the command fails", async () => {
    const context = createContext()
    const message = "failed to read 'echo oops >&2; exit 3' -> exited with code 3: oops"

    expect(await readOrMessage(context.h, "echo oops >&2; exit 3")).toBe(message)
    expect(getFailureMessage(context)).toBe(message)
  })

  it("should leave stderr out of the failure when it's empty", async () => {
    const { h } = createContext()

    expect(await readOrMessage(h, "exit 1")).toBe("failed to read 'exit 1' -> exited with code 1")
  })

  it("should throw the first failure again without running anything once the host has failed", async () => {
    const file = path.join(await makeTempDir("read-"), "ran")
    const { h } = createContext()
    await readOrMessage(h, "exit 1")

    expect(await readOrMessage(h, `touch '${file}'`)).toBe("failed to read 'exit 1' -> exited with code 1")
    expect(await Bun.file(file).exists()).toBe(false)
  })

  it("should keep the first failure when calls made at once both fail", async () => {
    const context = createContext()

    await Promise.allSettled([context.h.read("exit 1"), context.h.read("sleep 0.1; exit 2")])

    expect(getFailureMessage(context)).toBe("failed to read 'exit 1' -> exited with code 1")
  })

  it("should fail when the target isn't '@local'", async () => {
    const { h } = createContext("a.lan")

    expect(await readOrMessage(h, "echo hi")).toBe(
      "failed to read 'echo hi' -> target 'a.lan' isn't supported yet (only '@local')",
    )
  })
})
