import { describe, expect, it } from "bun:test"

import { attempt, isErr, messageChain } from "ts-explicit-errors"

import type { Host, HostFunction } from "#hosts/host.ts"
import { host } from "#hosts/host.ts"
import { runHost } from "#hosts/run.ts"

const throwBoom = () => {
  throw new Error("boom")
}

const doNothing = async () => {
  /* empty */
}

const catchFailedRead = async (h: Host) => {
  await attempt(async () => h.read("exit 1"))
}

/** Runs a host 'a' with `fn` and returns the error's message chain, if any. */
const runAndGetMessage = async (fn: HostFunction) => {
  const result = await runHost({ name: "a", ...host("@local", fn) }, "apply")
  return isErr(result) ? messageChain(result) : result
}

describe("runHost", () => {
  it("should return nothing when the host succeeds", async () => {
    expect(await runAndGetMessage(doNothing)).toBeUndefined()
  })

  it("should wrap the error when the host fails", async () => {
    expect(await runAndGetMessage(throwBoom)).toBe("failed to run host 'a' -> boom")
  })

  it("should pass the host's name to its function", async () => {
    const names: string[] = []
    // oxlint-disable-next-line typescript/require-await - a `HostFunction` must return a promise
    const recordName = async (h: Host) => void names.push(h.name)

    await runHost({ name: "a", ...host("@local", recordName) }, "apply")

    expect(names).toStrictEqual(["a"])
  })

  it("should stop the host function at a failed call", async () => {
    const steps: string[] = []
    const readThenRecord = async (h: Host) => {
      await h.read("exit 1")
      steps.push("after the read")
    }

    expect(await runAndGetMessage(readThenRecord)).toBe(
      "failed to run host 'a' -> failed to read 'exit 1' -> exited with code 1",
    )
    expect(steps).toStrictEqual([])
  })

  it("should report a failed call even when the host function catches it", async () => {
    expect(await runAndGetMessage(catchFailedRead)).toBe(
      "failed to run host 'a' -> failed to read 'exit 1' -> exited with code 1",
    )
  })
})
