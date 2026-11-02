import { attempt, isErr, messageChain } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import { host } from "#hosts/host.ts"
import type { Host } from "#session/session.ts"
import { createHostSession } from "#session/session.ts"
import type { Change } from "#session/step-functions/change.ts"
import type { EnsureOptions } from "#session/steps/ensure.ts"
import type { RunOptions } from "#session/steps/run.ts"

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

/** Inspects `cmd` and returns its result, or the thrown error's message chain. */
export const inspectOrMessage = async (h: Host, cmd: string) => {
  const result = await attempt(async () => h.inspect(cmd))
  return isErr(result) ? messageChain(result) : result
}

/** Runs `h.ensure` and returns its result, or the thrown error's message chain. */
export const ensureOrMessage = async <T extends string | boolean>(h: Host, options: EnsureOptions<T>) => {
  const result = await attempt(async () => h.ensure("Make marker", options))
  return isErr(result) ? messageChain(result) : result
}

/** Runs `h.run` and returns its result, or the thrown error's message chain. */
export const runOrMessage = async (h: Host, cmd: Change, options: RunOptions) => {
  const result = await attempt(async () => h.run("Make marker", cmd, options))
  return isErr(result) ? messageChain(result) : result
}

/** Returns the message chain of the host's recorded failure, if any. */
export const getFailureMessage = (hostSession: ReturnType<typeof createSession>) => {
  const failure = hostSession.getFailure()
  return failure && messageChain(failure)
}
