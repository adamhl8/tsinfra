import { attempt, isErr } from "ts-explicit-errors"

import type { HostEntry } from "#hosts/prepare/prepare.ts"
import type { Mode } from "#mode.ts"
import { createHostSession } from "#session/session.ts"
import type { HostRecord } from "#session/session.ts"

/** Calls the script's host function with its `Host`, catches what it throws, and returns the host's record. */
export const runHost = async (hostEntry: HostEntry, mode: Mode): Promise<HostRecord> => {
  const { loadedHost, hostRecord, sessionContext } = hostEntry
  if (!sessionContext) return hostRecord

  const host = createHostSession(sessionContext, mode)
  const fnResult = await attempt(async () => loadedHost.fn(host))

  // Keep the failure the session recorded as it is, because a script that catches it can go on to throw something else.
  // Record a throw with no failure before it as the host function's, because no step is running.
  if (isErr(fnResult) && !hostRecord.failure) sessionContext.sessionRecorder.recordFailure(fnResult)

  return hostRecord
}
