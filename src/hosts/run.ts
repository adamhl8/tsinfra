import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { LoadedHost } from "#hosts/load.ts"
import type { HostDetails, ReadyHostDetails } from "#session/host-details.ts"
import { buildHostDetails, finishHostDetails } from "#session/host-details.ts"
import type { HostContext } from "#session/session.ts"
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
  hostReport.started && hostReport.stepRecords.some(({ status }) => status === "changed")

const DRIFT_EXIT_CODE = 2

/** Returns the run's exit code: 1 for a failed host, 2 for drift in `plan`, and 0 otherwise. */
export const getExitCode = (hostReports: HostReport[], mode: Mode): number => {
  // Exit 1 for a failed host even when another has drift, because the plan is incomplete.
  if (hostReports.some(({ failure }) => failure)) return 1

  const hasAnyDrift = hostReports.some((hostReport) => hasDrift(hostReport))
  return mode === "plan" && hasAnyDrift ? DRIFT_EXIT_CODE : 0
}

/** A host that preflight prepared, ready to run. */
interface PreparedHostEntry {
  loadedHost: LoadedHost
  hostContext: HostContext
}

/** A host that preflight couldn't prepare, like an unreachable one, so its script never runs. */
interface UnpreparedHostEntry {
  loadedHost: LoadedHost
  failure: Error
}

/** What preparing a host gave: a host ready to run, or one that couldn't be prepared. */
export type HostEntry = PreparedHostEntry | UnpreparedHostEntry

/** Finishes a host's details, prompting for its sudo password when it has no transport yet, and builds its context. */
const buildHostContext = async (
  loadedHost: LoadedHost,
  hostDetails: HostDetails | ReadyHostDetails,
): Promise<Result<HostContext>> => {
  const readyHostDetails = "transport" in hostDetails ? hostDetails : await finishHostDetails(loadedHost, hostDetails)
  if (isErr(readyHostDetails)) return readyHostDetails

  const { name } = loadedHost
  const { home, transport } = readyHostDetails
  return { name, transport, home }
}

/**
 * Prepares every host at once, before any script runs, and keeps them in order. Prompts for sudo passwords after every
 * host is prepared, one host at a time, so the prompts come in the hosts' order.
 */
export const prepareHosts = async (loadedHosts: LoadedHost[]): Promise<HostEntry[]> => {
  const builtHostDetails = await Promise.all(
    loadedHosts.map(async (loadedHost) => ({ loadedHost, hostDetails: await buildHostDetails(loadedHost) })),
  )

  const hostEntries: HostEntry[] = []
  for (const { loadedHost, hostDetails } of builtHostDetails) {
    // oxlint-disable-next-line no-await-in-loop - prompts run one at a time
    const hostContext = isErr(hostDetails) ? hostDetails : await buildHostContext(loadedHost, hostDetails)
    const hostEntry = isErr(hostContext) ? { loadedHost, failure: hostContext } : { loadedHost, hostContext }
    hostEntries.push(hostEntry)
  }
  return hostEntries
}

/** Calls the script's host function with its `Host`, catches what it throws, and reports what the host did. */
export const runHost = async (hostEntry: HostEntry, mode: Mode): Promise<HostReport> => {
  const { name, target, fn: hostFunction } = hostEntry.loadedHost
  if ("failure" in hostEntry)
    return { name, target, started: false, failure: err("failed to prepare the host", hostEntry.failure) }

  const { host, stepRecords, getFailure } = createHostSession(hostEntry.hostContext, mode)
  const fnResult = await attempt(async () => hostFunction(host))

  // Report the failure recorded in the session first, because a script that catches it can go on to throw something else.
  const failure = getFailure() ?? (isErr(fnResult) ? fnResult : undefined)

  return { name, started: true, stepRecords, failure }
}
