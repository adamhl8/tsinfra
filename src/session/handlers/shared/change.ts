import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { attempt, isErr } from "ts-explicit-errors"

import type { ChangeTools } from "#session/handlers/tools.ts"
import type { StepContext } from "#session/step.ts"
import { nonEmptyStringSchema } from "#session/step.ts"

type ChangeFunction<TExtra extends unknown[]> = (tools: ChangeTools, ...extra: TExtra) => Promise<void>

/**
 * A run's command, or a step's fix: a command, or a function that runs several commands by calling `exec`. A function
 * gets its tools, then `TExtra`, which only a fix uses, for what its check found.
 */
export type Change<TExtra extends unknown[] = []> = string | ChangeFunction<TExtra>

// Type the function as a `ChangeFunction`, because only "is a function" can be validated at runtime.
export const changeSchema = type
  .declare<Change>()
  .type(nonEmptyStringSchema.or(type("Function").as<ChangeFunction<[]>>()))

/** Runs `change` as a command, or calls the script's function with its tools and `extra`, and catches what it throws. */
export const runChange = async <TExtra extends unknown[]>(
  ctx: StepContext,
  change: Change<TExtra>,
  ...extra: TExtra
): Promise<Result> => {
  const { shell, changeTools } = ctx

  // Discard what `change` returns, because `attempt` would treat a returned `Error` as a thrown one.
  // Only a throw fails a change.
  if (typeof change === "function") {
    return attempt(async () => {
      await change(changeTools, ...extra)
    })
  }

  const stdout = await shell.exec(change)
  if (isErr(stdout)) return stdout
}
