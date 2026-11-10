import { attempt, isErr } from "ts-explicit-errors"

import type { HostEntry } from "#hosts/prepare/prepare.ts"
import type { Mode } from "#mode.ts"
import { createHostSession } from "#session/session.ts"
import type { StepRecord } from "#session/session.ts"
import type { Failure } from "#utils.ts"

/** A host whose script ran. A failed host still has the records of the steps that ran before the failure. */
interface StartedHostReport {
  name: string
  started: true
  stepRecords: StepRecord[]
  /** Set when a step failed or the script threw. */
  failure: Failure
}

/** A host that couldn't be prepared, like an unreachable one, so its script never ran. */
interface UnstartedHostReport {
  name: string
  target: string
  started: false
  failure: Error
  /** How to fix the failure, which the report shows under it. */
  failureHints: string[]
}

/** What a host's run did. */
export type HostReport = StartedHostReport | UnstartedHostReport

/** Reports whether a step found the host different from the script, which is drift, and makes `plan` exit 2. */
export const hasDrift = (hostReport: HostReport) =>
  hostReport.started && hostReport.stepRecords.some(({ status }) => status === "changed")

const DRIFT_EXIT_CODE = 2

/** Returns the run's exit code: 1 for a failed host, 2 for drift in `plan`, and 0 otherwise. */
export const getExitCode = (hostReports: HostReport[], mode: Mode): number => {
  // Exit 1 for a failed host even when another has drift, because the plan is incomplete.
  if (hostReports.some(({ failure }) => failure)) return 1

  const hasAnyDrift = hostReports.some((hostReport) => hasDrift(hostReport))
  return mode === "plan" && hasAnyDrift ? DRIFT_EXIT_CODE : 0
}

/** Calls the script's host function with its `Host`, catches what it throws, and reports what the host did. */
export const runHost = async (hostEntry: HostEntry, mode: Mode): Promise<HostReport> => {
  const { name, target, fn: hostFunction } = hostEntry.loadedHost
  if ("failure" in hostEntry) {
    const { failure, failureHints } = hostEntry
    return { name, target, started: false, failure, failureHints }
  }

  const { host, stepRecords, getFailure } = createHostSession(hostEntry.hostContext, mode)
  const fnResult = await attempt(async () => hostFunction(host))

  // Report the failure recorded in the session first, because a script that catches it can go on to throw something else.
  const failure = getFailure() ?? (isErr(fnResult) ? fnResult : undefined)

  return { name, started: true, stepRecords, failure }
}
