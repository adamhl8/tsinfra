import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { attempt, isErr } from "ts-explicit-errors"

import type { ChangeTools } from "#session/handlers/tools.ts"
import type { StepContext } from "#session/step.ts"
import { nonEmptyStringSchema } from "#session/step.ts"

type ChangeFunction = (tools: ChangeTools) => Promise<void>

/** A step's fix, or a run's command: a command, or a function that runs several commands by calling `exec`. */
export type Change = string | ChangeFunction

// Type the function as a `ChangeFunction`, because only "is a function" can be validated at runtime.
export const changeSchema = type.declare<Change>().type(nonEmptyStringSchema.or(type("Function").as<ChangeFunction>()))

/** Runs `change` as a command, or calls the script's function with its tools, and catches what it throws. */
export const runChange = async (ctx: StepContext, change: Change): Promise<Result> => {
  const { shell, changeTools } = ctx

  // Discard what `change` returns, because `attempt` would treat a returned `Error` as a thrown one.
  // Only a throw fails a change.
  if (typeof change === "function") {
    return attempt(async () => {
      await change(changeTools)
    })
  }

  const stdout = await shell.run(change)
  if (isErr(stdout)) return stdout
}
