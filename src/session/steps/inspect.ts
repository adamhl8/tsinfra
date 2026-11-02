import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Shell } from "#session/shell.ts"

/** What `inspect` gives a script: a command's stdout and stderr, both trimmed, and its exit code. */
export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Runs one command and returns its output and exit code. A non-zero exit is an answer, not a failure. */
export type Inspect = (cmd: string) => Promise<CommandResult>

export const handleInspect = async (shell: Shell, cmd: string): Promise<Result<CommandResult>> => {
  const commandOutput = await shell.inspect(cmd)
  if (isErr(commandOutput)) return err(`failed to inspect '${cmd}'`, commandOutput)

  const { stdout, stderr, exitCode } = commandOutput
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}
