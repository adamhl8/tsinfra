import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { ReadTools } from "#session/methods/read.ts"
import type { CommandResult } from "#session/shell.ts"
import type { Action, Mismatch, StepCall, StepDetails } from "#session/step.ts"
import { runAction } from "#session/step.ts"

export interface FixOptions {
  /** A command, or a function that runs several commands by calling `exec`. It only runs in `apply`. */
  fix: Action
  /**
   * Runs the check again after the fix, and fails the step when it still fails. Defaults to true. Set it to false only
   * for a fix whose effect nothing in the run can make visible, like one that needs a reboot.
   */
  verify?: boolean
}

export interface CheckResult {
  checkPassed: boolean
  mismatch?: Mismatch
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

/**
 * Runs a step's check as a command, or calls the script's check function, passing it `read`, and catches what it
 * throws.
 */
export const runCheck = async <T>(
  stepCall: StepCall,
  check: string | ((tools: ReadTools) => Promise<T>),
): Promise<Result<CheckRun<T>>> => {
  const { shell, read, stepName } = stepCall

  if (typeof check === "function") {
    const value = await attempt(async () => check({ read }))
    if (isErr(value)) return err(`failed to check step '${stepName}'`, value)

    return { type: "function", value }
  }

  const commandResult = await shell.inspect(check)
  if (isErr(commandResult)) return err(`failed to check step '${stepName}'`, commandResult)

  return { type: "command", commandResult }
}

/** Runs the part every step shares: check, fix in `apply`, then check again. */
export const converge = async (
  stepCall: StepCall,
  evaluate: () => Promise<Result<CheckResult>>,
  fixOptions: FixOptions,
): Promise<Result<StepDetails>> => {
  const { mode, stepName } = stepCall
  const { fix, verify = true } = fixOptions

  const before = await evaluate()
  if (isErr(before)) return before
  if (before.checkPassed) return { changed: false }

  const { mismatch } = before
  const changedDetails: StepDetails = mismatch ? { changed: true, mismatch } : { changed: true }
  if (mode === "plan") return changedDetails

  const fixResult = await runAction(stepCall, fix)
  if (isErr(fixResult)) return err(`failed to run the fix for step '${stepName}'`, fixResult)
  if (!verify) return changedDetails

  const after = await evaluate()
  if (isErr(after)) return after
  if (!after.checkPassed) {
    const facts = formatCheckFacts(after)
    return err(`the check for step '${stepName}' still fails after the fix${facts}`, undefined)
  }

  return changedDetails
}
