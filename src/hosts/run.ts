import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { LoadedHost } from "#hosts/load.ts"
import type { HostContext } from "#session/host-context.ts"
import { buildHostContext } from "#session/host-context.ts"
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

/** A host that couldn't be prepared, like an unreachable one, so its script never ran. */
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

const DRIFT_EXIT_CODE = 2

/** Returns the run's exit code: 1 for a failed host, 2 for drift in `plan`, and 0 otherwise. */
export const getExitCode = (hostReports: HostReport[], mode: Mode): number => {
  // Exit 1 for a failed host even when another has drift, because the plan is incomplete.
  if (hostReports.some(({ failure }) => failure)) return 1

  const hasAnyDrift = hostReports.some((hostReport) => hasDrift(hostReport))
  return mode === "plan" && hasAnyDrift ? DRIFT_EXIT_CODE : 0
}

/** A loaded host and what preparing it gave, which `runHost` reports when it's an error. */
export interface PreparedHost {
  loadedHost: LoadedHost
  hostContext: Result<HostContext>
}

/** Prepares one host. */
export const prepareHost = async (loadedHost: LoadedHost): Promise<PreparedHost> => {
  const hostContext = await buildHostContext(loadedHost)
  return { loadedHost, hostContext }
}

/** Prepares every host at once, before any script runs, and keeps them in order. */
export const prepareHosts = async (loadedHosts: LoadedHost[]): Promise<PreparedHost[]> =>
  Promise.all(loadedHosts.map(async (loadedHost) => prepareHost(loadedHost)))

/** Calls the script's host function with its `Host`, catches what it throws, and reports what the host did. */
export const runHost = async (preparedHost: PreparedHost, mode: Mode): Promise<HostReport> => {
  const { loadedHost, hostContext } = preparedHost
  const { name, target, fn: hostFunction } = loadedHost
  if (isErr(hostContext))
    return { name, target, started: false, failure: err("failed to prepare the host", hostContext) }

  const { host, stepRecords, getFailure } = createHostSession(hostContext, mode)
  const fnResult = await attempt(async () => hostFunction(host))

  // Report the failure recorded in the session first, because a script that catches it can go on to throw something else.
  const failure = getFailure() ?? (isErr(fnResult) ? fnResult : undefined)

  return { name, started: true, stepRecords, failure }
}
