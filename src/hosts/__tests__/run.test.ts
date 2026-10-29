import { describe, expect, it } from "bun:test"

import { isErr, messageChain } from "ts-explicit-errors"

import type { HostFunction } from "#hosts/host.ts"
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
})
