import { attempt, isErr, messageChain } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import { host } from "#hosts/host.ts"
import type { EnsureOptions } from "#session/handlers/ensure.ts"
import type { FileOptions } from "#session/handlers/file.ts"
import type { RunOptions } from "#session/handlers/run.ts"
import type { Change } from "#session/handlers/shared/change.ts"
import type { Host } from "#session/session.ts"
import { createHostSession } from "#session/session.ts"

const doNothing = async () => {
  /* empty */
}

export const throwBoom = () => {
  throw new Error("boom")
}

/** Creates a session for a host 'a' on `@local`. */
export const createSession = async (mode: Mode = "apply") => {
  const hostSession = await createHostSession({ name: "a", ...host("@local", doNothing) }, mode)
  if (isErr(hostSession)) throw hostSession
  return hostSession
}

/** Reads `cmd` and returns its output, or the thrown error's message chain. */
export const readOrMessage = async (h: Host, cmd: string) => {
  const output = await attempt(async () => h.read(cmd))
  return isErr(output) ? messageChain(output) : output
}

/** Runs `h.ensure` and returns its result, or the thrown error's message chain. */
export const ensureOrMessage = async <T extends string | boolean>(h: Host, options: EnsureOptions<T>) => {
  const result = await attempt(async () => h.ensure("Make marker", options))
  return isErr(result) ? messageChain(result) : result
}

/** Runs `h.file` on `path` and returns its result, or the thrown error's message chain. */
export const fileOrMessage = async (h: Host, path: string, options: FileOptions) => {
  const result = await attempt(async () => h.file(path, options))
  return isErr(result) ? messageChain(result) : result
}

/** Runs `h.run` and returns its result, or the thrown error's message chain. */
export const runOrMessage = async (h: Host, cmd: Change, options: RunOptions) => {
  const result = await attempt(async () => h.run("Make marker", cmd, options))
  return isErr(result) ? messageChain(result) : result
}

/** Returns the message chain of the host's recorded failure, if any. */
export const getFailureMessage = (hostSession: Awaited<ReturnType<typeof createSession>>) => {
  const failure = hostSession.getFailure()
  return failure && messageChain(failure)
}
