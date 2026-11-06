import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { Comparison } from "#session/handlers/shared/converge.ts"
import type { ReadTools } from "#session/handlers/tools.ts"
import { createCommandExitError } from "#session/shell.ts"
import type { StepContext } from "#session/step.ts"
import { nonEmptyStringSchema } from "#session/step.ts"
import type { CommandOutput } from "#transport/transport.ts"
import { stripTrailingNewlines } from "#utils.ts"

type CheckFunction<T> = (tools: ReadTools) => Promise<T>

/** A step's check: a command, or a function given `ReadTools` that returns the value to compare. */
export type Check<T> = string | CheckFunction<T>

// Type the function as a `CheckFunction`, because only "is a function" can be validated at runtime.
export const checkSchema = type
  .declare<Check<Want>>()
  .type(nonEmptyStringSchema.or(type("Function").as<CheckFunction<Want>>()))

export const wantSchema = type("string | boolean")
export type Want = typeof wantSchema.infer

// Require the check's value to have `want`'s type, which `want` alone decides.
const checkFnValueSchema = type({ value: "string", want: "string" }).or({ value: "boolean", want: "boolean" })

/** What the check gave and what it wanted, as raw values. `kind` says how the output shows them. */
export type EnsureComparisonValues =
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
 * Validates a check function's value against `want`'s type, then compares the two. The value is `unknown` because a
 * script can get past the types and return anything.
 */
const compareFnValue = (value: unknown, want: Want): Result<Comparison> => {
  const valid = checkFnValueSchema({ value, want })
  if (valid instanceof type.errors) {
    return err(
      "failed to validate the value the check returned",
      err(`it's of type ${typeof value}, but want is of type ${typeof want}`, undefined),
    )
  }

  if (typeof valid.want === "string") return compareStrings(valid.value, valid.want)
  return { inSync: valid.value === valid.want, values: { kind: "boolean", got: valid.value, want: valid.want } }
}

/** Compares a check command's stdout, or its exit code, to `want`. */
const compareCommandOutput = (commandOutput: CommandOutput, want: Want): Result<Comparison> => {
  const { stdout, exitCode } = commandOutput

  if (typeof want === "string") {
    const comparison = compareStrings(stdout, want)

    // Fail a broken check whose output happens to match, so it can't look converged.
    if (exitCode !== 0 && comparison.inSync) return createCommandExitError(commandOutput)

    return comparison
  }

  return { inSync: (exitCode === 0) === want, values: { kind: "exit", got: exitCode, want } }
}

/** Runs `check` as a command, or calls the script's function with its tools, and compares the answer to `want`. */
export const compareCheck = async (
  ctx: StepContext,
  check: Check<unknown>,
  want: Want,
): Promise<Result<Comparison>> => {
  const { shell, readTools } = ctx

  if (typeof check === "function") {
    // Wrap the value, because `attempt` would treat a returned `Error` as a thrown one.
    const returned = await attempt(async () => ({ value: await check(readTools) }))
    return isErr(returned) ? returned : compareFnValue(returned.value, want)
  }

  const commandOutput = await shell.inspect(check)
  return isErr(commandOutput) ? commandOutput : compareCommandOutput(commandOutput, want)
}
