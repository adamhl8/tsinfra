import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { CommandOptions, RecordingTransport, StepRecorder } from "#session/step-recorder.ts"
import { createRootTransport } from "#transport/sudo.ts"
import type { CommandOutput, Transport } from "#transport/transport.ts"

export interface Shell {
  /** Runs `cmd` and returns its output untouched. Only failing to run at all is an error. */
  inspect: (cmd: string, options?: CommandOptions) => Promise<Result<CommandOutput>>
  /** Runs `cmd` and returns its stdout. Failing to run and a non-zero exit are both errors. */
  exec: (cmd: string, options?: CommandOptions) => Promise<Result<string>>
}

/** Describes a non-zero exit as an error, with the exit code and stderr in its message. */
export const createCommandExitError = (commandOutput: CommandOutput) => {
  const { stderr, exitCode } = commandOutput
  let trimmedStderr = stderr.trim()
  trimmedStderr &&= `: ${trimmedStderr}`
  return err(`exited with code ${exitCode}${trimmedStderr}`, undefined)
}

/** Binds `transport` into the two ways the session runs commands. A plain `Transport` records nothing. */
export const createShell = (transport: RecordingTransport): Shell => {
  const inspect = transport

  const exec = async (cmd: string, options?: CommandOptions): Promise<Result<string>> => {
    const output = await inspect(cmd, options)
    if (isErr(output)) return output
    if (output.exitCode !== 0) return createCommandExitError(output)

    return output.stdout
  }

  return { inspect, exec }
}

/**
 * Returns the shell a step runs on, recording each command under the step, and running as root for `sudo: true`. Record
 * above the root transport, so the record holds the step's script without the `sudo sh -s` around it.
 */
export const createStepShell = (
  transport: Transport,
  recordCommands: StepRecorder["recordCommands"],
  sudo: boolean,
): Shell => {
  const stepTransport = sudo ? createRootTransport(transport) : transport
  return createShell(recordCommands(stepTransport))
}
