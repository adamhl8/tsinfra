import type { CommandRecord } from "#session/recorder/records.ts"
import type { RecordingTransport, Transport } from "#transport/transport.ts"

/**
 * Returns `transport` with each command it runs recorded through `addCommand`. Each recorder passes its own, which
 * decides where the record goes.
 */
export const createRecordingTransport =
  (transport: Transport, addCommand: (commandRecord: CommandRecord) => void): RecordingTransport =>
  async (cmd, options = {}) => {
    const { label, recordedCmd = cmd } = options
    const commandRecord: CommandRecord = { cmd: recordedCmd, ...(label !== undefined && { label }) }
    // Add the record before the command runs, so commands run at once keep the order they were called in.
    addCommand(commandRecord)
    const output = await transport(cmd)
    commandRecord.output = output
    return output
  }
