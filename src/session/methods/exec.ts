import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Shell } from "#session/shell.ts"

/** Runs one command in a fix or run function and returns its stdout. A non-zero exit throws. */
export type Exec = (cmd: string) => Promise<string>

/** What a fix or run function is given. */
export interface ExecTools {
  exec: Exec
}

/** Runs one command of a fix or run function, and names the command when it fails. */
export const handleExec = async (shell: Shell, cmd: string): Promise<Result<string>> => {
  const stdout = await shell.run(cmd)
  if (isErr(stdout)) return err(`failed to run '${cmd}'`, stdout)

  return stdout
}
