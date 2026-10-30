import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { Shell } from "#session/shell.ts"

export interface FixOptions {
  fix: string
}

export interface StepResult {
  /** True when the step changed something, or would in `plan`, so a follow-up guarded by it shows up in the plan too. */
  changed: boolean
}

/** What stays the same for one call of a step method like `h.ensure`. */
export interface StepCall {
  shell: Shell
  mode: Mode
  stepName: string
}

export interface CheckResult {
  checkPassed: boolean
  /** Why the check fails, shown when it still fails after the fix. */
  detail?: string
}

const indentLines = (text: string) => text.replaceAll(/^/gmv, "  ")

/** Calls a check or read function from the script, and names the step when it throws. */
export const callCheckFunction = async <T>(stepName: string, checkFunction: () => Promise<T>): Promise<Result<T>> => {
  const value = await attempt(async () => checkFunction())
  if (isErr(value)) return err(`failed to check step '${stepName}'`, value)

  return value
}

/** Runs the part every step shares: check, fix in `apply`, then check again. */
export const converge = async (
  { shell, mode, stepName }: StepCall,
  evaluate: () => Promise<Result<CheckResult>>,
  fix: string,
): Promise<Result<StepResult>> => {
  const before = await evaluate()
  if (isErr(before)) return before
  if (before.checkPassed) return { changed: false }
  if (mode === "plan") return { changed: true }

  const fixResult = await shell.run(fix)
  if (isErr(fixResult)) return err(`failed to run the fix for step '${stepName}'`, fixResult)

  const after = await evaluate()
  if (isErr(after)) return after
  if (!after.checkPassed) {
    const detail = after.detail === undefined ? "" : `\n${indentLines(after.detail)}`
    return err(`the check for step '${stepName}' still fails after the fix${detail}`, undefined)
  }

  return { changed: true }
}
