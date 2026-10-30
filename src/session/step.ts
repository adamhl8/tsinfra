import type { Result } from "ts-explicit-errors"
import { attempt, isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { Exec } from "#session/methods/exec.ts"
import type { Shell } from "#session/shell.ts"

export interface StepResult {
  /** True when the step changed something, or would in `plan`, so a follow-up guarded by it shows up in the plan too. */
  changed: boolean
}

/** What stays the same for one call of a step, like `h.ensure` or `h.run`. */
export interface StepCall {
  shell: Shell
  exec: Exec
  mode: Mode
  stepName: string
}

/** A command, or a function that runs several commands by calling `exec`. A step's fix and `h.run` each take one. */
export type Action = string | ((exec: Exec) => Promise<void>)

/** Runs `action` as a command, or calls the script's function, passing it `exec`, and catches what it throws. */
export const runAction = async (stepCall: StepCall, action: Action): Promise<Result> => {
  const { shell, exec } = stepCall

  if (typeof action === "function") return attempt(async () => action(exec))

  const stdout = await shell.run(action)
  if (isErr(stdout)) return stdout
}
