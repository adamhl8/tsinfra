import { describe, expect, it } from "bun:test"

import { attempt, messageChain } from "ts-explicit-errors"

import type { HostFunction } from "#hosts/host.ts"
import { host } from "#hosts/host.ts"
import { hasPendingChange, runHost } from "#hosts/run.ts"
import type { Host } from "#session/session.ts"

const throwBoom = () => {
  throw new Error("boom")
}

const doNothing = async () => {
  /* empty */
}

const catchFailedRead = async (h: Host) => {
  await attempt(async () => h.read("exit 1"))
}

const readTwice = async (h: Host) => {
  await h.read("echo hi")
  await h.read("exit 1")
}

const runHostA = async (fn: HostFunction) => runHost({ name: "a", ...host("@local", fn) }, "apply")

/** Plans a host 'a' with `fn` and reports whether it has a change pending. */
const planHasPendingChange = async (fn: HostFunction) => {
  const { stepRecords } = await runHost({ name: "a", ...host("@local", fn) }, "plan")
  return hasPendingChange(stepRecords)
}

const ensurePending = async (h: Host) => {
  await h.ensure("Pending", { check: "false", fix: "true" })
}

const runOnly = async (h: Host) => {
  await h.read("true")
  await h.run("Prune", "true", { when: true })
}

const failCheck = async (h: Host) => {
  await h.ensure("Broken", { check: throwBoom, fix: "true" })
}

const getMessage = (failure: Error | undefined) => failure && messageChain(failure)

/** Runs a host 'a' with `fn` and returns its failure's message chain, if any. */
const runAndGetMessage = async (fn: HostFunction) => getMessage((await runHostA(fn)).failure)

describe("runHost", () => {
  it("should report no failure when the host succeeds", async () => {
    expect(await runAndGetMessage(doNothing)).toBeUndefined()
  })

  it("should return the records of the steps that ran, even when the host fails", async () => {
    const { stepRecords, failure } = await runHostA(readTwice)

    expect(stepRecords.map(({ name }) => name)).toStrictEqual(["echo hi", "exit 1"])
    expect(getMessage(failure)).toBe("failed to run host 'a' -> failed to read 'exit 1' -> exited with code 1")
  })

  it("should wrap the error when the host fails", async () => {
    expect(await runAndGetMessage(throwBoom)).toBe("failed to run host 'a' -> boom")
  })

  it("should pass the host's name to its function", async () => {
    const names: string[] = []
    // oxlint-disable-next-line typescript/require-await - a `HostFunction` must return a promise
    const recordName = async (h: Host) => void names.push(h.name)

    await runHostA(recordName)

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

describe("hasPendingChange", () => {
  it("should be true when a step's check did not pass", async () => {
    expect(await planHasPendingChange(ensurePending)).toBe(true)
  })

  it("should be false when only a read and a run happened", async () => {
    expect(await planHasPendingChange(runOnly)).toBe(false)
  })

  it("should be false when the only step failed", async () => {
    expect(await planHasPendingChange(failCheck)).toBe(false)
  })
})
