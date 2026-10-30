import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { ShellOutput } from "#transport/local.ts"
import type { Transport } from "#transport/transport.ts"

const TRAILING_NEWLINES = /\n+$/v

interface CommandOutput {
  /** The command's stdout without trailing newlines. */
  stdout: string
  /** Set when the command exits non-zero, with the exit code and stderr in its message. */
  exitError: Error | undefined
}

export interface Shell {
  /** Runs `cmd` and describes how it went. Only failing to run at all is an error. */
  inspect: (cmd: string) => Promise<Result<CommandOutput>>
  /** Runs `cmd` and returns its stdout. Failing to run and a non-zero exit are both errors. */
  run: (cmd: string) => Promise<Result<string>>
}

export const stripTrailingNewlines = (text: string) => text.replace(TRAILING_NEWLINES, "")

const createCommandExitError = ({ exitCode, stderr }: ShellOutput) => {
  let trimmedStderr = stderr.trim()
  trimmedStderr &&= `: ${trimmedStderr}`
  return err(`exited with code ${exitCode}${trimmedStderr}`, undefined)
}

/** Binds `transport` into the two ways the session runs commands. */
export const createShell = (transport: Transport): Shell => {
  const inspect = async (cmd: string): Promise<Result<CommandOutput>> => {
    const output = await transport(cmd)
    if (isErr(output)) return output

    const stdout = stripTrailingNewlines(output.stdout)
    const exitError = output.exitCode === 0 ? undefined : createCommandExitError(output)

    return { stdout, exitError }
  }

  const run = async (cmd: string): Promise<Result<string>> => {
    const output = await inspect(cmd)
    if (isErr(output)) return output
    if (output.exitError) return output.exitError

    return output.stdout
  }

  return { inspect, run }
}
