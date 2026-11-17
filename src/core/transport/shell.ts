import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { CommandOutput } from "#core/transport.ts"
import { wrapCommandWithInput } from "#core/transport/utils.ts"
import { createCommandExitError } from "#utils.ts"

export interface CommandOptions {
  /** A short name for a command tsinfra wrote itself. */
  label?: string
  /** The text to record in place of the command, for one that holds content. */
  recordedCmd?: string
  /** The data the command reads on its stdin, which the record never holds. */
  input?: Uint8Array
  /** Whether the command's output is a secret, which the record masks from this command on. */
  maskOutput?: boolean
}

/** Runs a command like a `Transport`, and also takes what the recorder needs to know about it. */
export type RecordingTransport = (cmd: string, options?: CommandOptions) => Promise<Result<CommandOutput>>

export interface Shell {
  /** Runs `cmd` and returns its output untouched. Only failing to run at all is an error. */
  inspect: (cmd: string, options?: CommandOptions) => Promise<Result<CommandOutput>>
  /** Runs `cmd` and returns its stdout. Failing to run and a non-zero exit are both errors. */
  exec: (cmd: string, options?: CommandOptions) => Promise<Result<string>>
}

/** Binds `transport` into the two ways the session runs commands. A plain `Transport` records nothing. */
export const createShell = (transport: RecordingTransport): Shell => {
  const inspect = async (cmd: string, options: CommandOptions = {}): Promise<Result<CommandOutput>> => {
    const { input, recordedCmd = cmd } = options
    if (input === undefined) return transport(cmd, options)

    const cmdWithInput = wrapCommandWithInput(cmd, input)
    // Record `cmd` as the script wrote it, because `cmdWithInput` holds the input.
    return transport(cmdWithInput, { ...options, recordedCmd })
  }

  const exec = async (cmd: string, options: CommandOptions = {}): Promise<Result<string>> => {
    const output = await inspect(cmd, options)
    if (isErr(output)) return output
    if (output.exitCode !== 0) return createCommandExitError(output)

    return output.stdout
  }

  return { inspect, exec }
}
