import { describe, expect, it } from "bun:test"

import { isErr, messageChain } from "ts-explicit-errors"

import type { Host, HostFunction } from "#hosts/host.ts"
import { host } from "#hosts/host.ts"
import { runHost } from "#hosts/run.ts"

const throwBoom = () => {
  throw new Error("boom")
}

const doNothing = async () => {
  /* empty */
}

/** Runs a host 'a' with `fn` and returns the error's message chain, if any. */
const runAndGetMessage = async (fn: HostFunction) => {
  const result = await runHost({ name: "a", file: "", ...host("a.lan", fn) })
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
    const received: Host[] = []
    // oxlint-disable-next-line typescript/require-await - a `HostFunction` must return a promise
    const recordHost = async (h: Host) => void received.push(h)

    await runHost({ name: "a", file: "", ...host("a.lan", recordHost) })

    expect(received).toStrictEqual([{ name: "a" }])
  })
})
