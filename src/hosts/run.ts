import { attempt, isErr } from "ts-explicit-errors"

import type { HostEntry } from "#hosts/prepare/prepare.ts"
import type { Mode } from "#mode.ts"
import { createHostSession } from "#session/session.ts"
import type { HostRecord } from "#session/session.ts"

/** Reports whether the host failed, in preparation, in a step, or in its host function. */
export const hasFailed = (hostRecord: HostRecord): boolean =>
  isErr(hostRecord.preparation.status) || hostRecord.failure !== undefined

/** Reports whether a step found the host different from the script, which is drift, and makes `plan` exit 2. */
export const hasDrift = (hostRecord: HostRecord) => hostRecord.stepRecords.some(({ status }) => status === "changed")

const DRIFT_EXIT_CODE = 2

/** Returns the run's exit code: 1 for a failed host, 2 for drift in `plan`, and 0 otherwise. */
export const getExitCode = (hostRecords: HostRecord[], mode: Mode): number => {
  // Exit 1 for a failed host even when another has drift, because the plan is incomplete.
  if (hostRecords.some((hostRecord) => hasFailed(hostRecord))) return 1

  const hasAnyDrift = hostRecords.some((hostRecord) => hasDrift(hostRecord))
  return mode === "plan" && hasAnyDrift ? DRIFT_EXIT_CODE : 0
}

/** Calls the script's host function with its `Host`, catches what it throws, and returns the host's record. */
export const runHost = async (hostEntry: HostEntry, mode: Mode): Promise<HostRecord> => {
  if (!("hostContext" in hostEntry)) return hostEntry.hostRecorder.hostRecord

  const { host, hostRecord } = createHostSession(hostEntry.hostContext, mode)
  const fnResult = await attempt(async () => hostEntry.loadedHost.fn(host))

  // Keep the failure the session recorded, because a script that catches it can go on to throw something else.
  if (isErr(fnResult)) hostRecord.failure ??= fnResult

  return hostRecord
}
