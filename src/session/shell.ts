import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { CommandOutput, Transport } from "#transport/transport.ts"

const TRAILING_NEWLINES = /\n+$/v

export interface Shell {
  /** Runs `cmd` and returns its output untouched. Only failing to run at all is an error. */
  inspect: (cmd: string) => Promise<Result<CommandOutput>>
  /** Runs `cmd` and returns its stdout. Failing to run and a non-zero exit are both errors. */
  run: (cmd: string) => Promise<Result<string>>
}

export const stripTrailingNewlines = (text: string) => text.replace(TRAILING_NEWLINES, "")

/** Describes a non-zero exit as an error, with the exit code and stderr in its message. */
export const createCommandExitError = (commandOutput: CommandOutput) => {
  const { exitCode, stderr } = commandOutput
  let trimmedStderr = stderr.trim()
  trimmedStderr &&= `: ${trimmedStderr}`
  return err(`exited with code ${exitCode}${trimmedStderr}`, undefined)
}

/** Binds `transport` into the two ways the session runs commands. */
export const createShell = (transport: Transport): Shell => {
  const inspect = transport

  const run = async (cmd: string): Promise<Result<string>> => {
    const output = await inspect(cmd)
    if (isErr(output)) return output
    if (output.exitCode !== 0) return createCommandExitError(output)

    return output.stdout
  }

  return { inspect, run }
}
