import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { Exec } from "#session/exec.ts"
import type { CommandResult, Shell } from "#session/shell.ts"

export interface FixOptions {
  /** A command, or a function that runs several with `exec`. It only runs in `apply`. */
  fix: string | ((exec: Exec) => Promise<void>)
  /**
   * Runs the check again after the fix, and fails the step when it still fails. Defaults to true. Set it to false only
   * for a fix whose effect nothing in the run can make visible, like one that needs a reboot.
   */
  verify?: boolean
}

export interface StepResult {
  /** True when the step changed something, or would in `plan`, so a follow-up guarded by it shows up in the plan too. */
  changed: boolean
}

/** What stays the same for one call of a step method like `h.ensure`. */
export interface StepCall {
  shell: Shell
  exec: Exec
  mode: Mode
  stepName: string
}

export interface CheckResult {
  checkPassed: boolean
  /** The values `ensureValue` compared, when they differ. */
  mismatch?: { read: string; want: string }
  /** Set when a check command exited non-zero. */
  exitError?: Error | undefined
}

/** What a check produced: a check function's value, or a check command's result. */
export type CheckRun<T> = { type: "function"; value: T } | { type: "command"; commandResult: CommandResult }

const indentLines = (text: string) => text.replaceAll(/^/gmv, "  ")

/** Lists what a failing check found, one indented line each, to follow the error's first line. */
const formatCheckFacts = (checkResult: CheckResult) => {
  const { mismatch, exitError } = checkResult
  const facts = [
    ...(mismatch ? [`read: ${mismatch.read}`, `want: ${mismatch.want}`] : []),
    ...(exitError ? [exitError.message] : []),
  ]
  return facts.map((fact) => `\n${indentLines(fact)}`).join("")
}

/** Runs a step's check, as a command or a function, and names the step when it can't run. */
export const runCheck = async <T>(
  stepCall: StepCall,
  check: string | (() => Promise<T>),
): Promise<Result<CheckRun<T>>> => {
  const { shell, stepName } = stepCall

  if (typeof check === "function") {
    const value = await attempt(async () => check())
    if (isErr(value)) return err(`failed to check step '${stepName}'`, value)

    return { type: "function", value }
  }

  const commandResult = await shell.inspect(check)
  if (isErr(commandResult)) return err(`failed to check step '${stepName}'`, commandResult)

  return { type: "command", commandResult }
}

const runFix = async (stepCall: StepCall, fix: FixOptions["fix"]): Promise<Result> => {
  const { shell, exec } = stepCall

  if (typeof fix === "function") return attempt(async () => fix(exec))

  const stdout = await shell.run(fix)
  if (isErr(stdout)) return stdout
}

/** Runs the part every step shares: check, fix in `apply`, then check again. */
export const converge = async (
  stepCall: StepCall,
  evaluate: () => Promise<Result<CheckResult>>,
  fixOptions: FixOptions,
): Promise<Result<StepResult>> => {
  const { mode, stepName } = stepCall
  const { fix, verify = true } = fixOptions

  const before = await evaluate()
  if (isErr(before)) return before
  if (before.checkPassed) return { changed: false }
  if (mode === "plan") return { changed: true }

  const fixResult = await runFix(stepCall, fix)
  if (isErr(fixResult)) return err(`failed to run the fix for step '${stepName}'`, fixResult)
  if (!verify) return { changed: true }

  const after = await evaluate()
  if (isErr(after)) return after
  if (!after.checkPassed) {
    const facts = formatCheckFacts(after)
    return err(`the check for step '${stepName}' still fails after the fix${facts}`, undefined)
  }

  return { changed: true }
}
