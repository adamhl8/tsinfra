import { attempt, isErr } from "ts-explicit-errors"

import type { HostEntry } from "#core/hosts/prepare.ts"
import type { HostRecord } from "#core/recorder/records.ts"
import { createHostSession } from "#core/session.ts"
import type { Mode } from "#mode.ts"

/** Calls the script's host function with its `Host`, catches what it throws, and returns the host's record. */
export const runHost = async (hostEntry: HostEntry, mode: Mode): Promise<HostRecord> => {
  if (hostEntry.preparation === "failed") return hostEntry.hostRecord

  const { hostFn, hostRecord, sessionSetup } = hostEntry

  const host = createHostSession(sessionSetup, mode)
  const fnResult = await attempt(async () => hostFn(host))

  // Keep the failure the session recorded as it is, because a script that catches it can go on to throw something else.
  if (hostRecord.failure) return hostRecord

  // Record a throw with no failure before it as the host function's, because no step is running.
  if (isErr(fnResult)) {
    sessionSetup.sessionRecorder.recordFailure(fnResult, "host fn")
    return hostRecord
  }

  // Close the open changes only after a clean `apply`, because then every follow-up has had its turn.
  // A host that failed returned above, so it keeps them, and its next apply triggers what this one missed.
  if (mode !== "apply") return hostRecord

  const closeAllResult = await sessionSetup.savedStateManager.closeAll()
  if (isErr(closeAllResult)) sessionSetup.sessionRecorder.recordFailure(closeAllResult, "saved state")

  return hostRecord
}
