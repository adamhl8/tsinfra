import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { HostEntry } from "#hosts/load.ts"
import { createHostSession } from "#session/session.ts"

export const runHost = async (hostEntry: HostEntry, mode: Mode): Promise<Result> => {
  const { host, getFailure } = createHostSession(hostEntry, mode)
  const fnResult = await attempt(async () => hostEntry.fn(host))

  // Report the failure recorded in `hostSession` first, because a script that catches it can go on to throw something else.
  const failure = getFailure()
  if (failure) return err(`failed to run host '${hostEntry.name}'`, failure)
  if (isErr(fnResult)) return err(`failed to run host '${hostEntry.name}'`, fnResult)
}
