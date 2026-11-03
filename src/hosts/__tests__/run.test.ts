import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { attempt, isErr, messageChain } from "ts-explicit-errors"

import { prepareAndRunHost } from "#__tests__/session.ts"
import type { HostFunction } from "#hosts/host.ts"
import { host } from "#hosts/host.ts"
import { hasDrift, prepareHosts } from "#hosts/run.ts"
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

const runHostA = async (fn: HostFunction) => prepareAndRunHost({ name: "a", ...host("@local", fn) }, "apply")

/** Plans a host 'a' with `fn` and reports whether it has drift. */
const planHasDrift = async (fn: HostFunction) =>
  hasDrift(await prepareAndRunHost({ name: "a", ...host("@local", fn) }, "plan"))

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

const getMessage = (failure: Error | undefined) => failure && messageChain(failure)

/** Runs a host 'a' with `fn` and returns its failure's message chain, if any. */
const runAndGetMessage = async (fn: HostFunction) => getMessage((await runHostA(fn)).failure)

describe("prepareHosts", () => {
  it("should prepare every host in order without running a script", async () => {
    const marker = path.join(await makeTempDir("prepare-"), "ran")
    const touchMarker = async (h: Host) => {
      await h.read(`touch '${marker}'`)
    }
    const preparedHosts = await prepareHosts([
      { name: "a", ...host("@local", touchMarker) },
      { name: "b", ...host("b.lan", touchMarker) },
      { name: "c", ...host("@local", touchMarker) },
    ])

    expect(preparedHosts.map(({ loadedHost, hostContext }) => [loadedHost.name, isErr(hostContext)])).toStrictEqual([
      ["a", false],
      ["b", true],
      ["c", false],
    ])
    expect(await Bun.file(marker).exists()).toBe(false)
  })
})

describe("runHost", () => {
  it("should fail before the script runs when the host can't run commands", async () => {
    const { failure, ...hostReport } = await prepareAndRunHost({ name: "a", ...host("a.lan", throwBoom) }, "apply")

    expect({ ...hostReport, message: getMessage(failure) }).toStrictEqual({
      name: "a",
      target: "a.lan",
      started: false,
      message:
        "failed to prepare the host -> failed to read the SSH user's home directory -> target 'a.lan' isn't supported yet (only '@local')",
    })
  })

  it("should report no failure when the host succeeds", async () => {
    expect(await runAndGetMessage(doNothing)).toBeUndefined()
  })

  it("should return the records of the steps that ran, even when the host fails", async () => {
    const hostReport = await runHostA(readTwice)

    expect(hostReport).toMatchObject({ started: true, stepRecords: [{ name: "echo hi" }, { name: "exit 1" }] })
    expect(getMessage(hostReport.failure)).toBe("failed to read 'exit 1' -> exited with code 1")
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
