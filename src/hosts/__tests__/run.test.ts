import { describe, expect, it } from "bun:test"
import { symlink } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { attempt, messageChain } from "ts-explicit-errors"

import { UNREACHABLE_TARGET, getPreparationFailure, prepareAndRunHost, toLoadedHost } from "#__tests__/session.ts"
import type { HostFunction } from "#hosts/host.ts"
import { host } from "#hosts/host.ts"
import { getExitCode, hasDrift } from "#hosts/run.ts"
import type { Host } from "#session/session.ts"
import type { Failure } from "#utils.ts"

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

const runHostA = async (fn: HostFunction) => prepareAndRunHost(toLoadedHost("a", host("@local", fn)), "apply")

/** Plans a host 'a' with `fn` and reports whether it has drift. */
const planHasDrift = async (fn: HostFunction) => {
  const hostRecord = await prepareAndRunHost(toLoadedHost("a", host("@local", fn)), "plan")
  return hasDrift(hostRecord)
}

const planReport = async (name: string, fn: HostFunction) =>
  prepareAndRunHost(toLoadedHost(name, host("@local", fn)), "plan")

const ensurePending = async (h: Host) => {
  await h.ensure("Pending", { check: "false", want: true, fix: "true" })
}

const runOnly = async (h: Host) => {
  await h.read("true")
  await h.run("Prune", "true", { after: "always" })
}

const failCheck = async (h: Host) => {
  await h.ensure("Broken", { check: throwBoom, want: true, fix: "true" })
}

const getMessage = (failure: Failure) => failure && messageChain(failure)

/** Runs a host 'a' with `fn` and returns its failure's message chain, if any. */
const runAndGetMessage = async (fn: HostFunction) => getMessage((await runHostA(fn)).failure)

describe("runHost", () => {
  it("should fail before the script runs when the host can't run commands", async () => {
    const hostRecord = await prepareAndRunHost(toLoadedHost("a", host(UNREACHABLE_TARGET, throwBoom)), "apply")

    expect(hostRecord).toMatchObject({
      name: "a",
      target: UNREACHABLE_TARGET,
      preparation: { failureHints: [] },
      stepRecords: [],
      failure: undefined,
    })
    expect(messageChain(getPreparationFailure(hostRecord))).toBe(
      "failed to read the ssh config for 'unreachable host' -> exited with code 255: hostname contains invalid characters",
    )
  })

  it("should report no failure when the host succeeds", async () => {
    expect(await runAndGetMessage(doNothing)).toBeUndefined()
  })

  it("should return the records of the steps that ran, even when the host fails", async () => {
    const hostRecord = await runHostA(readTwice)

    expect(hostRecord).toMatchObject({ stepRecords: [{ name: "echo hi" }, { name: "exit 1" }] })
    expect(getMessage(hostRecord.failure)).toBe("failed to read 'exit 1' -> exited with code 1")
  })

  it("should report the error when the host function throws", async () => {
    expect(await runAndGetMessage(throwBoom)).toBe("boom")
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

    expect(await runAndGetMessage(readThenRecord)).toBe("failed to read 'exit 1' -> exited with code 1")
    expect(steps).toStrictEqual([])
  })

  it("should report a failed call even when the host function catches it", async () => {
    expect(await runAndGetMessage(catchFailedRead)).toBe("failed to read 'exit 1' -> exited with code 1")
  })
})

describe("hasDrift", () => {
  it("should be true when a step's check did not pass", async () => {
    expect(await planHasDrift(ensurePending)).toBe(true)
  })

  it("should be false when only a read and a run happened", async () => {
    expect(await planHasDrift(runOnly)).toBe(false)
  })

  it("should be false when the only step failed", async () => {
    expect(await planHasDrift(failCheck)).toBe(false)
  })
})

describe("getExitCode", () => {
  it("should be 0 from plan when the only change is a run", async () => {
    expect(getExitCode([await planReport("a", runOnly)], "plan")).toBe(0)
  })

  it("should be 2 from plan when a host has drift", async () => {
    expect(getExitCode([await planReport("a", ensurePending)], "plan")).toBe(2)
  })

  it("should be 0 from apply when a host has drift", async () => {
    expect(getExitCode([await planReport("a", ensurePending)], "apply")).toBe(0)
  })

  it("should be 0 from plan when the only finding is a warning", async () => {
    const directory = await makeTempDir()
    const linkPath = path.join(directory, "link")
    const target = path.join(directory, "missing")
    await symlink(target, linkPath)

    const hostRecord = await planReport("a", async (h) => {
      await h.link(linkPath, target)
    })

    expect(getExitCode([hostRecord], "plan")).toBe(0)
  })

  it("should be 1 when a host fails, even with drift on another", async () => {
    const hostRecords = [await planReport("a", ensurePending), await planReport("b", failCheck)]

    expect(getExitCode(hostRecords, "plan")).toBe(1)
  })
})
