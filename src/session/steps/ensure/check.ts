import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { Comparison } from "#session/converge.ts"
import { createCommandExitError } from "#session/shell.ts"
import type { CheckTools } from "#session/step-functions/tools.ts"
import type { StepContext } from "#session/step.ts"
import { nonEmptyStringSchema } from "#session/step.ts"
import type { CommandOutput } from "#transport/transport.ts"
import { stripTrailingNewlines } from "#utils.ts"

type CheckFunction<T> = (tools: CheckTools) => Promise<T>

/** A step's check: a command, or a function given `CheckTools` that returns the value to compare. */
export type Check<T> = string | CheckFunction<T>

// Type the function as a `CheckFunction`, because only "is a function" can be validated at runtime.
export const checkSchema = type
  .declare<Check<string | boolean>>()
  .type(nonEmptyStringSchema.or(type("Function").as<CheckFunction<string | boolean>>()))

/** What the check gave and what it wanted, as raw values. `kind` says how the output shows them. */
export type EnsureComparison =
  | { kind: "string"; got: string; want: string }
  | { kind: "boolean"; got: boolean; want: boolean }
  // `got` is the exit code, and `want: true` means exit 0.
  | { kind: "exit"; got: number; want: boolean }

const compareStrings = (value: string, wantedValue: string): Comparison => {
  const got = stripTrailingNewlines(value)
  const want = stripTrailingNewlines(wantedValue)
  return { inSync: got === want, values: { kind: "string", got, want } }
}

/**
 * Compares a check function's value to `want`. The value is `unknown` because a script can get past the types, like
 * with `as` or `@ts-ignore`, so a check function can return anything.
 */
const compareFnValue = (value: unknown, want: string | boolean): Result<Comparison> => {
  if (typeof value === "string" && typeof want === "string") return compareStrings(value, want)

  if (typeof value === "boolean" && typeof want === "boolean")
    return { inSync: value === want, values: { kind: "boolean", got: value, want } }

  return err(`the check returned a ${typeof value}, but want is a ${typeof want}`, undefined)
}

/** Compares a check command's stdout, or its exit code, to `want`. */
const compareCommandOutput = (commandOutput: CommandOutput, want: string | boolean): Result<Comparison> => {
  const { stdout, exitCode } = commandOutput

  if (typeof want === "string") {
    const comparison = compareStrings(stdout, want)

    // Fail a broken check whose output happens to match, so it can't look converged.
    if (exitCode !== 0 && comparison.inSync) return createCommandExitError(commandOutput)

    return { ...comparison, commandOutput }
  }

  return { inSync: (exitCode === 0) === want, values: { kind: "exit", got: exitCode, want }, commandOutput }
}

/** Runs `check` as a command, or calls the script's function with its tools, and compares the answer to `want`. */
export const compareCheck = async (
  ctx: StepContext,
  check: Check<unknown>,
  want: string | boolean,
): Promise<Result<Comparison>> => {
  const { shell, checkTools } = ctx

  if (typeof check === "function") {
    const value = await attempt(async () => check(checkTools))
    return isErr(value) ? value : compareFnValue(value, want)
  }

  const commandOutput = await shell.inspect(check)
  return isErr(commandOutput) ? commandOutput : compareCommandOutput(commandOutput, want)
}
