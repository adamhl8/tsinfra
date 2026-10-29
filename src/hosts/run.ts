import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { HostEntry } from "#hosts/load.ts"
import { createHostSession } from "#hosts/session.ts"

export const runHost = async (hostEntry: HostEntry): Promise<Result> => {
  const hostSession = createHostSession(hostEntry)
  const fnResult = await attempt(async () => hostEntry.fn(hostSession.host))

  // Report the failure recorded in `hostSession` first, because a script that catches it can go on to throw something else.
  const failure = hostSession.getFailure()
  if (failure) return err(`failed to run host '${hostEntry.name}'`, failure)
  if (isErr(fnResult)) return err(`failed to run host '${hostEntry.name}'`, fnResult)
}
