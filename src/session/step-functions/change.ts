import type { Result } from "ts-explicit-errors"
import { attempt, isErr } from "ts-explicit-errors"

import type { ChangeTools } from "#session/step-functions/tools.ts"
import type { StepCall } from "#session/step.ts"

/** A step's fix, or a run's command: a command, or a function that runs several commands by calling `exec`. */
export type Change = string | ((tools: ChangeTools) => Promise<void>)

/** Runs `change` as a command, or calls the script's function with its tools, and catches what it throws. */
export const runChange = async (stepCall: StepCall, change: Change): Promise<Result> => {
  const { shell, changeTools } = stepCall

  if (typeof change === "function") return attempt(async () => change(changeTools))

  const stdout = await shell.run(change)
  if (isErr(stdout)) return stdout
}
