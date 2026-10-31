import { attempt, err, isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { HostEntry } from "#hosts/load.ts"
import { createHostSession } from "#session/session.ts"
import type { StepRecord } from "#session/step-records.ts"

/** What a host's run did. A failed host still has the records of the steps that ran before the failure. */
export interface HostReport {
  stepRecords: StepRecord[]
  /** Set when a step failed or the script threw. */
  failure: Error | undefined
}

/** Calls the script's host function with its `Host`, catches what it throws, and reports what the host did. */
export const runHost = async (hostEntry: HostEntry, mode: Mode): Promise<HostReport> => {
  const { host, stepRecords, getFailure } = createHostSession(hostEntry, mode)
  const fnResult = await attempt(async () => hostEntry.fn(host))

  // Report the failure recorded in the session first, because a script that catches it can go on to throw something else.
  const hostFailure = getFailure() ?? (isErr(fnResult) ? fnResult : undefined)
  const failure = hostFailure && err(`failed to run host '${hostEntry.name}'`, hostFailure)

  return { stepRecords, failure }
}
