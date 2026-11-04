import type { Result } from "ts-explicit-errors"
import { err, getContext, isErr } from "ts-explicit-errors"

import type { NeededSteps } from "#session/handlers/shared/change-step-result.ts"
import type { ComparisonValues, StepContext, StepOutcome } from "#session/step.ts"
import type { CommandOutput } from "#transport/transport.ts"

/** How the part of the host one step manages compared with what the step wants, and the values it compared. */
export interface Comparison {
  inSync: boolean
  values: ComparisonValues
  /** The output of the command that read the state. A check function can run several commands, so it has none. */
  commandOutput?: CommandOutput
}

/** What a step gives `converge`: how to compare the host's state, how to fix it, and whether to compare again after. */
export interface ConvergeSpec {
  /** Earlier steps whose change this step's state depends on. */
  needs: NeededSteps
  /** Returns a bare error, because `converge` names the step when it wraps it. */
  /** Reads the host's state and compares it with what the step wants. */
  compare: () => Promise<Result<Comparison>>
  fix: () => Promise<Result>
  verify: boolean
}

const FAILED_COMPARISON_KEY = "failedComparison"

/** Returns the report that a "still differs after the fix" error carries, so the output can show what it found. */
export const getFailedComparison = (error: Error) => getContext<Comparison>(error, FAILED_COMPARISON_KEY)

/** Compares the host's state with what the step wants, then in `apply` runs the fix when it differs, and compares again. */
export const converge = async (ctx: StepContext, spec: ConvergeSpec): Promise<Result<StepOutcome>> => {
  const { stepName, mode } = ctx
  const { needs, compare, fix, verify } = spec

  // Skip reading the state in `plan` when a needed step would change, because the read would miss that change.
  const pendingNeeds = needs.filter(({ changed }) => changed).map(({ name }) => name)
  if (mode === "plan" && pendingNeeds.length > 0) return { status: "waiting", changed: true, needs: pendingNeeds }

  const before = await compare()
  if (isErr(before)) return err(`failed to compare the host with what step '${stepName}' wants`, before)
  if (before.inSync) return { status: "unchanged", changed: false }

  const changedOutcome: StepOutcome = { status: "changed", changed: true, values: before.values }
  if (mode === "plan") return changedOutcome

  const fixResult = await fix()
  if (isErr(fixResult)) return err(`failed to run the fix for step '${stepName}'`, fixResult)
  if (!verify) return changedOutcome

  const after = await compare()
  if (isErr(after)) return err(`failed to compare the host with what step '${stepName}' wants`, after)
  if (!after.inSync) {
    return err(`the host's state still differs after the fix for step '${stepName}'`, undefined, {
      [FAILED_COMPARISON_KEY]: after,
    })
  }

  return changedOutcome
}
