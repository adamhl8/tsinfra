import type { ValidHostOptions } from "#core/hosts/host.ts"
import { getFailureHints } from "#core/recorder/failure-hints.ts"
import type { HostRecord, HostWarningRecord } from "#core/recorder/records.ts"
import type { CommandRecord } from "#core/recorder/records/command.ts"
import type { Transport } from "#core/transport.ts"
import type { CommandRecorder, RecordOutput, Shell } from "#core/transport/shell.ts"
import { createShell } from "#core/transport/shell.ts"

/** Records a host's preparation, before its script runs: the commands preparation runs, its warnings, and its failure. */
export interface PreparationRecorder extends HostWarningRecorder {
  /** Returns a shell on `transport` that records each command on the host's preparation. */
  getShell: (transport: Transport) => Shell
  /** Records `error` as the preparation's failure, with hints for it. */
  recordFailure: (error: Error) => void
}

/** The part of the preparation recorder a fact's reader records through. */
export interface HostWarningRecorder {
  /** Records a warning about the whole host, which worked but needs a look. */
  recordWarning: (warning: HostWarningRecord) => void
}

/** Records a host's preparation on `hostRecord`. */
export const createPreparationRecorder = (
  hostRecord: HostRecord,
  hostOptions: ValidHostOptions,
): PreparationRecorder => {
  // Record the output as it is, because preparation never sees a secret.
  const commandRecorder: CommandRecorder = {
    recordCommand: (shellCommand) => {
      const commandRecord: CommandRecord = {
        ...shellCommand,
        toolCall: undefined,
        phase: undefined,
        output: undefined,
      }
      hostRecord.preparationCommands.push(commandRecord)

      const recordOutput: RecordOutput = (output) => {
        commandRecord.output = output
      }
      return recordOutput
    },
  }

  const getShell = (transport: Transport) => createShell(transport, { commandRecorder })

  const recordWarning = (warning: HostWarningRecord) => {
    hostRecord.warnings.push(warning)
  }

  // Record it as the host's first failure, because nothing else runs on the host before preparation finishes.
  const recordFailure = (error: Error) => {
    const hints = getFailureHints(hostRecord.target, hostOptions, hostRecord.preparationCommands)
    hostRecord.failure = { kind: "preparation", error, hints }
  }

  return { recordWarning, getShell, recordFailure }
}
