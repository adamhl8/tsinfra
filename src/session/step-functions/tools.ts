import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Shell } from "#session/shell.ts"
import type { Inspect } from "#session/steps/inspect.ts"
import type { Read } from "#session/steps/read.ts"

/** Runs one command in a fix or run function and returns its stdout, trimmed. A non-zero exit throws. */
export type Exec = (cmd: string) => Promise<string>

/** Runs one command of a fix or run function, and names the command when it fails. */
export const handleExec = async (shell: Shell, cmd: string): Promise<Result<string>> => {
  const stdout = await shell.run(cmd)
  if (isErr(stdout)) return err(`failed to run '${cmd}'`, stdout)

  return stdout.trim()
}

/** What a check function is given. It also runs during `plan`, so it gets no tool that changes the target. */
export interface CheckTools {
  read: Read
  inspect: Inspect
}

/** What a fix or run function is given. */
export interface ChangeTools {
  exec: Exec
  inspect: Inspect
}
