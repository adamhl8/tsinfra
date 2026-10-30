import { attempt, isErr, messageChain } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import { host } from "#hosts/host.ts"
import type { EnsureValueOptions } from "#session/methods/ensure-value.ts"
import type { EnsureOptions } from "#session/methods/ensure.ts"
import type { RunOptions } from "#session/methods/run.ts"
import type { Host } from "#session/session.ts"
import { createHostSession } from "#session/session.ts"
import type { Action } from "#session/step.ts"

const doNothing = async () => {
  /* empty */
}

export const throwBoom = () => {
  throw new Error("boom")
}

export const createSession = (mode: Mode = "apply", target = "@local") =>
  createHostSession({ name: "a", ...host(target, doNothing) }, mode)

/** Reads `cmd` and returns its output, or the thrown error's message chain. */
export const readOrMessage = async (h: Host, cmd: string) => {
  const output = await attempt(async () => h.read(cmd))
  return isErr(output) ? messageChain(output) : output
}

/** Runs `h.ensure` and returns its result, or the thrown error's message chain. */
export const ensureOrMessage = async (h: Host, options: EnsureOptions) => {
  const result = await attempt(async () => h.ensure("Make marker", options))
  return isErr(result) ? messageChain(result) : result
}

/** Runs `h.ensureValue` and returns its result, or the thrown error's message chain. */
export const ensureValueOrMessage = async (h: Host, options: EnsureValueOptions) => {
  const result = await attempt(async () => h.ensureValue("Make marker", options))
  return isErr(result) ? messageChain(result) : result
}

/** Runs `h.run` and returns its result, or the thrown error's message chain. */
export const runOrMessage = async (h: Host, cmd: Action, options: RunOptions) => {
  const result = await attempt(async () => h.run("Make marker", cmd, options))
  return isErr(result) ? messageChain(result) : result
}

/** Returns the message chain of the host's recorded failure, if any. */
export const getFailureMessage = (hostSession: ReturnType<typeof createSession>) => {
  const failure = hostSession.getFailure()
  return failure && messageChain(failure)
}
