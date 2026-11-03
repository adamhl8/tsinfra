import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { attempt, isErr } from "ts-explicit-errors"

import type { HostState } from "#session/converge.ts"
import type { CheckTools } from "#session/step-functions/tools.ts"
import type { StepContext } from "#session/step.ts"
import { nonEmptyStringSchema } from "#session/step.ts"
import type { CommandOutput } from "#transport/transport.ts"

type CheckFunction<T> = (tools: CheckTools) => Promise<T>

/** A step's check: a command, or a function given `CheckTools` that returns the value to compare. */
export type Check<T> = string | CheckFunction<T>

// Type the function as a `CheckFunction`, because only "is a function" can be validated at runtime.
export const checkSchema = type
  .declare<Check<string | boolean>>()
  .type(nonEmptyStringSchema.or(type("Function").as<CheckFunction<string | boolean>>()))

/**
 * How a step compares its check's answer, for each form of `Check`. A check function's value is `unknown` because a
 * script can get past the types, like with `as` or `@ts-ignore`, so a check function can return anything.
 */
export interface CheckCompare {
  fnValue: (value: unknown) => Result<HostState>
  cmdValue: (commandOutput: CommandOutput) => Result<HostState>
}

/** Runs `check` as a command, or calls the script's function with its tools, and compares the answer with `compare`. */
export const runCheck = async (
  ctx: StepContext,
  check: Check<unknown>,
  compare: CheckCompare,
): Promise<Result<HostState>> => {
  const { shell, checkTools } = ctx

  if (typeof check === "function") {
    const value = await attempt(async () => check(checkTools))
    return isErr(value) ? value : compare.fnValue(value)
  }

  const commandOutput = await shell.inspect(check)
  return isErr(commandOutput) ? commandOutput : compare.cmdValue(commandOutput)
}
