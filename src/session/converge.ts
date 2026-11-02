import type { Result } from "ts-explicit-errors"
import { err, getContext, isErr } from "ts-explicit-errors"

import type { Comparison, StepCall, StepDetails } from "#session/step.ts"
import type { CommandOutput } from "#transport/transport.ts"

/** The part of the host's state one step manages: whether it's as wanted, and the values the step compared. */
export interface HostState {
  inSync: boolean
  comparison: Comparison
  /** The check command's output. A check function can run several commands, so it has none. */
  commandOutput?: CommandOutput
}

/** What a step gives `converge`: how to read the host's state, how to fix it, and whether to read it again after. */
export interface ConvergeSpec {
  /** Returns a bare error, because `converge` names the step when it wraps it. */
  readState: () => Promise<Result<HostState>>
  fix: () => Promise<Result>
  verify: boolean
}

const FAILED_STATE_KEY = "failedState"

/** Returns the report that a "still differs after the fix" error carries, so the output can show what it found. */
export const getFailedState = (error: Error) => getContext<HostState>(error, FAILED_STATE_KEY)

/** Reads the host's state, then in `apply` runs the fix when it differs, and reads it again. */
export const converge = async (stepCall: StepCall, spec: ConvergeSpec): Promise<Result<StepDetails>> => {
  const { mode, stepName } = stepCall
  const { readState, fix, verify } = spec

  const before = await readState()
  if (isErr(before)) return err(`failed to read the host's state for step '${stepName}'`, before)
  if (before.inSync) return { status: "unchanged", changed: false }

  const changedDetails: StepDetails = { status: "changed", changed: true, comparison: before.comparison }
  if (mode === "plan") return changedDetails

  const fixResult = await fix()
  if (isErr(fixResult)) return err(`failed to run the fix for step '${stepName}'`, fixResult)
  if (!verify) return changedDetails

  const after = await readState()
  if (isErr(after)) return err(`failed to read the host's state for step '${stepName}'`, after)
  if (!after.inSync) {
    return err(`the host's state still differs after the fix for step '${stepName}'`, undefined, {
      [FAILED_STATE_KEY]: after,
    })
  }

  return changedDetails
}
