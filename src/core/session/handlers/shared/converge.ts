import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { StepNeeds } from "#core/session/handlers/options/step.ts"
import type { ComparePhase } from "#core/session/recorder/session-recorder.ts"
import type { ChangeStepKind, ComparisonValues, StepContext, StepStatus } from "#core/session/step.ts"

/**
 * How the part of the host one step manages compared with what the step wants, and the values it compared. Takes the
 * values' type, so a step's fix gets only its own kinds of values.
 */
export interface Comparison<V extends ComparisonValues = ComparisonValues> {
  inSync: boolean
  values: V
}

/**
 * What a step gives `converge`: how to read the host's state, how to compare it, how to fix it, and whether to compare
 * again after. Each function returns a bare error, because `converge` names the step when it wraps it.
 */
interface ConvergeSpec<HostDetails, V extends ComparisonValues> {
  /** Earlier steps whose change this step's state depends on. */
  needs: StepNeeds
  /** Reads what the step manages on the host. Runs in each compare phase, so its commands are recorded under it. */
  getHostDetails: () => Promise<Result<HostDetails>>
  /** Compares what `getHostDetails` read with what the step wants. A comparison that reads nothing more can be sync. */
  compare: (hostDetails: HostDetails) => Result<Comparison<V>> | Promise<Result<Comparison<V>>>
  /**
   * Gets what the `before` phase read, because a write keeps what it can of what it replaces, and how it compared, so a
   * fix can act on what differs.
   */
  fix: (hostDetails: HostDetails, comparison: Comparison<V>) => Promise<Result>
  verify: boolean
}

/** What one compare phase read from the host, and how it compared. */
interface PhaseResult<HostDetails, V extends ComparisonValues> {
  hostDetails: HostDetails
  comparison: Comparison<V>
}

const FAILED_COMPARE_MESSAGE = "failed to compare the host with what the step wants"

/**
 * Compares the host's state with what the step wants, then in `apply` runs the fix when it differs, and compares again.
 * Records what it does as it goes. Opens the step's change right before the fix, so the change is saved even when the
 * connection drops right after the fix succeeds.
 */
export const converge = async <HostDetails, V extends ComparisonValues>(
  ctx: StepContext<ChangeStepKind>,
  spec: ConvergeSpec<HostDetails, V>,
): Promise<Result<StepStatus>> => {
  const { stepName, mode, savedStateManager, changedStepNames, convergeRecorder } = ctx
  const { startPhase, recordComparison, recordWaitingOn } = convergeRecorder
  const { needs, getHostDetails, compare, fix, verify } = spec

  const compareInPhase = async (phase: ComparePhase): Promise<Result<PhaseResult<HostDetails, V>>> => {
    startPhase(phase)
    const hostDetails = await getHostDetails()
    if (isErr(hostDetails)) return hostDetails

    const comparison = await compare(hostDetails)
    if (isErr(comparison)) return comparison

    recordComparison(phase, comparison)
    return { hostDetails, comparison }
  }

  // Skip reading the state in `plan` when a needed step would change, because the read would miss that change.
  // Wait only on needed steps that changed in this pass.
  const pendingNeeds = needs.filter(({ name }) => changedStepNames.has(name)).map(({ name }) => name)
  if (mode === "plan" && pendingNeeds.length > 0) {
    recordWaitingOn(pendingNeeds)
    return "waiting"
  }

  const before = await compareInPhase("before")
  if (isErr(before)) return err(FAILED_COMPARE_MESSAGE, before)
  if (before.comparison.inSync) return "unchanged"
  if (mode === "plan") return "changed"

  const openChangeResult = await savedStateManager.openChange(stepName)
  if (isErr(openChangeResult)) return openChangeResult

  startPhase("fix")
  const fixResult = await fix(before.hostDetails, before.comparison)
  if (isErr(fixResult)) return err("failed to run the fix", fixResult)
  if (!verify) return "changed"

  const after = await compareInPhase("after")
  if (isErr(after)) return err(FAILED_COMPARE_MESSAGE, after)
  if (!after.comparison.inSync) return err("the host's state still differs after the fix", undefined)

  return "changed"
}
