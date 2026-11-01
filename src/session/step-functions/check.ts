import type { Result } from "ts-explicit-errors"
import { attempt, isErr } from "ts-explicit-errors"

import type { HostState } from "#session/converge.ts"
import type { CheckTools } from "#session/step-functions/tools.ts"
import type { StepCall } from "#session/step.ts"
import type { CommandResult } from "#transport/transport.ts"

/** A step's check: a command, or a function given `CheckTools` that returns the value to compare. */
export type Check<T> = string | ((tools: CheckTools) => Promise<T>)

/**
 * How a step compares its check's answer, for each form of `Check`. A check function's value is `unknown` because host
 * files aren't type-checked, so a check function can return anything.
 */
export interface CheckCompare {
  fnResult: (value: unknown) => Result<HostState>
  cmdResult: (commandResult: CommandResult) => Result<HostState>
}

/** Runs `check` as a command, or calls the script's function with its tools, and compares the answer with `compare`. */
export const runCheck = async (
  stepCall: StepCall,
  check: Check<unknown>,
  compare: CheckCompare,
): Promise<Result<HostState>> => {
  const { shell, checkTools } = stepCall

  if (typeof check === "function") {
    const value = await attempt(async () => check(checkTools))
    return isErr(value) ? value : compare.fnResult(value)
  }

  const commandResult = await shell.inspect(check)
  return isErr(commandResult) ? commandResult : compare.cmdResult(commandResult)
}
