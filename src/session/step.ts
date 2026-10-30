import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { CommandResult, Shell } from "#session/shell.ts"

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

/** What a check produced: a check function's value, or a check command's result. */
export type CheckRun<T> = { type: "function"; value: T } | { type: "command"; commandResult: CommandResult }

const indentLines = (text: string) => text.replaceAll(/^/gmv, "  ")

/** Runs a step's check, as a command or a function, and names the step when it can't run. */
export const runCheck = async <T>(
  { shell, stepName }: StepCall,
  check: string | (() => Promise<T>),
): Promise<Result<CheckRun<T>>> => {
  if (typeof check === "function") {
    const value = await attempt(async () => check())
    if (isErr(value)) return err(`failed to check step '${stepName}'`, value)

    return { type: "function", value }
  }

  const commandResult = await shell.inspect(check)
  if (isErr(commandResult)) return err(`failed to check step '${stepName}'`, commandResult)

  return { type: "command", commandResult }
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
