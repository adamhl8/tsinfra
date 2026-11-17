import type { Result } from "ts-explicit-errors"

import type { CommandRecord } from "#core/session/recorder/records.ts"
import type { CommandOutput, Transport } from "#core/transport.ts"
import type { CommandOptions, RecordingTransport } from "#core/transport/shell.ts"

/** Where a recording transport puts each command's record. Each recorder passes its own. */
export interface CommandRecorder {
  /** Records a command, before it runs. */
  recordCommand: (commandRecord: CommandRecord) => void
  /** Records the output on a command's record, once the command finishes. */
  recordOutput: (commandRecord: CommandRecord, output: Result<CommandOutput>, options: CommandOptions) => void
}

/** Returns `transport` with each command it runs recorded through `commandRecorder`. */
export const createRecordingTransport =
  (transport: Transport, commandRecorder: CommandRecorder): RecordingTransport =>
  async (cmd, options = {}) => {
    const { recordCommand, recordOutput } = commandRecorder
    const { label, recordedCmd = cmd } = options
    const commandRecord: CommandRecord = { cmd: recordedCmd, ...(label !== undefined && { label }) }
    // Record the command before it runs, so commands run at once keep the order they were called in.
    recordCommand(commandRecord)
    const output = await transport(cmd)
    recordOutput(commandRecord, output, options)
    return output
  }
