import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { stripTrailingNewlines } from "#session/shell.ts"
import type { CheckResult, FixOptions, StepCall, StepResult } from "#session/step.ts"
import { callCheckFunction, converge } from "#session/step.ts"

export interface EnsureValueOptions extends FixOptions {
  /**
   * A command whose output is compared to `want`, or a function that returns the value to compare. It also runs during
   * `plan`, so it must not change anything.
   */
  read: string | (() => Promise<string>)
  /** The value `read` should produce. Trailing newlines are ignored on both sides. */
  want: string
}

const compareToWant = (value: string, want: string): CheckResult => {
  const read = stripTrailingNewlines(value)
  const wanted = stripTrailingNewlines(want)
  return read === wanted ? { checkPassed: true } : { checkPassed: false, detail: `read: ${read}\nwant: ${wanted}` }
}

const evaluateReadWant = async (
  { shell, stepName }: StepCall,
  { read, want }: EnsureValueOptions,
): Promise<Result<CheckResult>> => {
  if (typeof read === "function") {
    const value = await callCheckFunction(stepName, read)
    if (isErr(value)) return value

    return compareToWant(value, want)
  }

  const output = await shell.inspect(read)
  if (isErr(output)) return err(`failed to check step '${stepName}'`, output)

  const outcome = compareToWant(output.stdout, want)
  if (!output.exitError) return outcome

  // Fail a broken read whose output happens to match, so it can't look converged.
  if (outcome.checkPassed) return err(`failed to check step '${stepName}'`, output.exitError)

  // Keep the exit error in the detail, because it can show that the read itself is broken.
  return { checkPassed: false, detail: `${outcome.detail ?? ""}\n${output.exitError.message}` }
}

export const runEnsureValue = async (stepCall: StepCall, options: EnsureValueOptions): Promise<Result<StepResult>> =>
  converge(stepCall, async () => evaluateReadWant(stepCall, options), options.fix)
