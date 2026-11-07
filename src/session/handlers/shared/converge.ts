import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { StepNeeds } from "#session/handlers/shared/step-options.ts"
import type { ComparePhase, ConvergeRecorder } from "#session/step-recorder.ts"
import type { ComparisonValues, StepStatus } from "#session/step.ts"

/** How the part of the host one step manages compared with what the step wants, and the values it compared. */
export interface Comparison {
  inSync: boolean
  values: ComparisonValues
}

/** What a step gives `converge`: how to compare the host's state, how to fix it, and whether to compare again after. */
interface ConvergeSpec {
  /** Earlier steps whose change this step's state depends on. */
  needs: StepNeeds
  /**
   * Reads the host's state and compares it with what the step wants. Returns a bare error, because `converge` names the
   * step when it wraps it.
   */
  compare: () => Promise<Result<Comparison>>
  fix: () => Promise<Result>
  verify: boolean
}

/** Compares the host's state with what the step wants, then in `apply` runs the fix when it differs, and compares again. */
export type Converge = (spec: ConvergeSpec) => Promise<Result<StepStatus>>

const FAILED_COMPARE_MESSAGE = "failed to compare the host with what the step wants"

/** Returns the `converge` a session's steps use, which records what it does as it goes. */
export const createConverge =
  (mode: Mode, recorder: ConvergeRecorder): Converge =>
  async (spec) => {
    const { startPhase, recordComparison, recordWaitingOn } = recorder
    const { needs, compare, fix, verify } = spec

    const compareInPhase = async (phase: ComparePhase) => {
      startPhase(phase)
      const comparison = await compare()
      if (!isErr(comparison)) recordComparison(phase, comparison)
      return comparison
    }

    // Skip reading the state in `plan` when a needed step would change, because the read would miss that change.
    const pendingNeeds = needs.filter(({ changed }) => changed).map(({ name }) => name)
    if (mode === "plan" && pendingNeeds.length > 0) {
      recordWaitingOn(pendingNeeds)
      return "waiting"
    }

    const before = await compareInPhase("before")
    if (isErr(before)) return err(FAILED_COMPARE_MESSAGE, before)
    if (before.inSync) return "unchanged"
    if (mode === "plan") return "changed"

    startPhase("fix")
    const fixResult = await fix()
    if (isErr(fixResult)) return err("failed to run the fix", fixResult)
    if (!verify) return "changed"

    const after = await compareInPhase("after")
    if (isErr(after)) return err(FAILED_COMPARE_MESSAGE, after)
    if (!after.inSync) return err("the host's state still differs after the fix", undefined)

    return "changed"
  }
