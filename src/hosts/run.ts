import { attempt, isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { LoadedHost } from "#hosts/load.ts"
import { createHostSession } from "#session/session.ts"
import type { StepRecord } from "#session/step-recorder.ts"

/** A host whose script ran. A failed host still has the records of the steps that ran before the failure. */
interface StartedHostReport {
  name: string
  started: true
  stepRecords: StepRecord[]
  /** Set when a step failed or the script threw. */
  failure: Error | undefined
}

/** A host whose session couldn't start, like an unreachable one, so its script never ran. */
interface UnstartedHostReport {
  name: string
  target: string
  started: false
  failure: Error
}

/** What a host's run did. */
export type HostReport = StartedHostReport | UnstartedHostReport

/** Reports whether a step found the host different from the script, which is drift, and makes `plan` exit 2. */
export const hasDrift = (hostReport: HostReport) =>
  hostReport.started && hostReport.stepRecords.some(({ outcome }) => !isErr(outcome) && outcome?.status === "changed")

/** Calls the script's host function with its `Host`, catches what it throws, and reports what the host did. */
export const runHost = async (loadedHost: LoadedHost, mode: Mode): Promise<HostReport> => {
  const { name, target } = loadedHost
  const hostSession = await createHostSession(loadedHost, mode)
  if (isErr(hostSession)) return { name, target, started: false, failure: hostSession }

  const { host, stepRecords, getFailure } = hostSession
  const fnResult = await attempt(async () => loadedHost.fn(host))

  // Report the failure recorded in the session first, because a script that catches it can go on to throw something else.
  const failure = getFailure() ?? (isErr(fnResult) ? fnResult : undefined)

  return { name, started: true, stepRecords, failure }
}
