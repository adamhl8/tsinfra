import type { Result } from "ts-explicit-errors"
import { attempt, isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { Exec, ExecTools } from "#session/methods/exec.ts"
import type { Read } from "#session/methods/read.ts"
import type { Shell } from "#session/shell.ts"

export interface StepResult {
  /** True when the step changed something, or would in `plan`, so a follow-up guarded by it shows up in the plan too. */
  changed: boolean
}

/** The values `ensureValue` compared, when they differ. */
export interface Mismatch {
  read: string
  want: string
}

/** What a step reports to the session. The script's type only shows `changed`, and the rest is for the output. */
export interface StepDetails extends StepResult {
  /** The values from the check before the fix. */
  mismatch?: Mismatch
}

/** What stays the same for one call of a step, like `h.ensure` or `h.run`. */
export interface StepCall {
  shell: Shell
  read: Read
  exec: Exec
  mode: Mode
  stepName: string
}

/** A command, or a function that runs several commands by calling `exec`. A step's fix and `h.run` each take one. */
export type Action = string | ((tools: ExecTools) => Promise<void>)

/** Runs `action` as a command, or calls the script's function, passing it `exec`, and catches what it throws. */
export const runAction = async (stepCall: StepCall, action: Action): Promise<Result> => {
  const { shell, exec } = stepCall

  if (typeof action === "function") return attempt(async () => action({ exec }))

  const stdout = await shell.run(action)
  if (isErr(stdout)) return stdout
}
