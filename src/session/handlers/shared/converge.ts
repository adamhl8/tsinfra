import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Mode } from "#mode.ts"
import type { StepNeeds } from "#session/handlers/step-options/step-options.ts"
import type { ComparePhase, ConvergeRecorder } from "#session/recorder/recorder.ts"
import type { ComparisonValues, StepStatus } from "#session/step.ts"

/** How the part of the host one step manages compared with what the step wants, and the values it compared. */
export interface Comparison {
  inSync: boolean
  values: ComparisonValues
}

/**
 * What a step gives `converge`: how to read the host's state, how to compare it, how to fix it, and whether to compare
 * again after. Each function returns a bare error, because `converge` names the step when it wraps it.
 */
interface ConvergeSpec<HostDetails> {
  /** Earlier steps whose change this step's state depends on. */
  needs: StepNeeds
  /** Reads what the step manages on the host. Runs in each compare phase, so its commands are recorded under it. */
  getHostDetails: () => Promise<Result<HostDetails>>
  /** Compares what `getHostDetails` read with what the step wants. A comparison that reads nothing more can be sync. */
  compare: (hostDetails: HostDetails) => Result<Comparison> | Promise<Result<Comparison>>
  /** Gets what the `before` phase read, because a write keeps what it can of what it replaces. */
  fix: (hostDetails: HostDetails) => Promise<Result>
  verify: boolean
}

/** Compares the host's state with what the step wants, then in `apply` runs the fix when it differs, and compares again. */
export type Converge = <HostDetails>(spec: ConvergeSpec<HostDetails>) => Promise<Result<StepStatus>>

/** What one compare phase read from the host, and how it compared. */
interface PhaseResult<HostDetails> {
  hostDetails: HostDetails
  comparison: Comparison
}

const FAILED_COMPARE_MESSAGE = "failed to compare the host with what the step wants"

/** Returns the `converge` a session's steps use, which records what it does as it goes. */
export const createConverge =
  (mode: Mode, recorder: ConvergeRecorder): Converge =>
  async <HostDetails>(spec: ConvergeSpec<HostDetails>): Promise<Result<StepStatus>> => {
    const { startPhase, recordComparison, recordWaitingOn } = recorder
    const { needs, getHostDetails, compare, fix, verify } = spec

    const compareInPhase = async (phase: ComparePhase): Promise<Result<PhaseResult<HostDetails>>> => {
      startPhase(phase)
      const hostDetails = await getHostDetails()
      if (isErr(hostDetails)) return hostDetails

      const comparison = await compare(hostDetails)
      if (isErr(comparison)) return comparison

      recordComparison(phase, comparison)
      return { hostDetails, comparison }
    }

    // Skip reading the state in `plan` when a needed step would change, because the read would miss that change.
    const pendingNeeds = needs.filter(({ changed }) => changed).map(({ name }) => name)
    if (mode === "plan" && pendingNeeds.length > 0) {
      recordWaitingOn(pendingNeeds)
      return "waiting"
    }

    const before = await compareInPhase("before")
    if (isErr(before)) return err(FAILED_COMPARE_MESSAGE, before)
    if (before.comparison.inSync) return "unchanged"
    if (mode === "plan") return "changed"

    startPhase("fix")
    const fixResult = await fix(before.hostDetails)
    if (isErr(fixResult)) return err("failed to run the fix", fixResult)
    if (!verify) return "changed"

    const after = await compareInPhase("after")
    if (isErr(after)) return err(FAILED_COMPARE_MESSAGE, after)
    if (!after.comparison.inSync) return err("the host's state still differs after the fix", undefined)

    return "changed"
  }
