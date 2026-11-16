import { describe, expect, it } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { attempt, messageChain } from "ts-explicit-errors"

import {
  UNREACHABLE_TARGET,
  getPreparationFailure,
  getPreparedHome,
  loadHostDefinition,
  prepareAndRunHost,
  readOpenChanges,
} from "#__tests__/session.ts"
import type { HostFunction } from "#hosts/host.ts"
import { host } from "#hosts/host.ts"
import { toSavedStatePath } from "#hosts/prepare/host-details/host-details.ts"
import type { Host, HostRecord } from "#session/session.ts"

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

const runHostA = async (fn: HostFunction) =>
  prepareAndRunHost(loadHostDefinition(host({ name: "a", target: "@local" }, fn)), "apply")

const getMessage = (failure: HostRecord["failure"]) => failure && messageChain(failure.error)

/** Runs a host 'a' with `fn` and returns its failure's message chain, if any. */
const runAndGetMessage = async (fn: HostFunction) => getMessage((await runHostA(fn)).failure)

describe("runHost", () => {
  it("should fail before the script runs when the host can't run commands", async () => {
    const hostRecord = await prepareAndRunHost(
      loadHostDefinition(host({ name: "a", target: UNREACHABLE_TARGET }, throwBoom)),
      "apply",
    )

    expect(hostRecord).toMatchObject({
      name: "a",
      target: UNREACHABLE_TARGET,
      stepRecords: [],
      failure: { kind: "preparation", hints: [] },
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

    expect(hostRecord).toMatchObject({
      stepRecords: [{ name: "echo hi" }],
      failure: { kind: "step", stepRecord: { name: "exit 1" } },
    })
    expect(getMessage(hostRecord.failure)).toBe("failed to read 'exit 1' -> exited with code 1")
  })

  it("should report the error when the host function throws, as the host function's failure", async () => {
    const { failure } = await runHostA(throwBoom)

    expect(failure).toMatchObject({ kind: "host fn" })
    expect(getMessage(failure)).toBe("boom")
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

  it("should close every open change after a clean apply", async () => {
    const marker = path.join(await makeTempDir(), "made")
    const loadedHost = loadHostDefinition(
      host({ name: "a", target: "@local" }, async (h) => {
        const madeMarker = await h.ensure("Make marker", {
          want: true,
          check: `test -f '${marker}'`,
          fix: `touch '${marker}'`,
        })
        await h.run("Restart", "true", { after: [madeMarker] })
      }),
    )

    const hostRecord = await prepareAndRunHost(loadedHost, "apply")

    expect(hostRecord.failure).toBeUndefined()
    expect(await readOpenChanges({ home: await getPreparedHome(loadedHost) })).toBeUndefined()
  })

  it("should fail the host as saved state when its open changes can't be closed after a clean apply", async () => {
    const marker = path.join(await makeTempDir(), "made")
    let savedStatePath = ""
    // Open a change, then put a directory where the saved state file is, so closing the changes can't delete it.
    const loadedHost = loadHostDefinition(
      host({ name: "a", target: "@local" }, async (h) => {
        await h.ensure("Make marker", { want: true, check: `test -f '${marker}'`, fix: `touch '${marker}'` })
        await rm(savedStatePath)
        await mkdir(savedStatePath)
      }),
    )
    savedStatePath = toSavedStatePath(await getPreparedHome(loadedHost), "a")

    const hostRecord = await prepareAndRunHost(loadedHost, "apply")

    expect(hostRecord.failure?.kind).toBe("saved state")
    expect(getMessage(hostRecord.failure)).toStartWith(`failed to delete the saved state in '${savedStatePath}' -> `)
  })
})
