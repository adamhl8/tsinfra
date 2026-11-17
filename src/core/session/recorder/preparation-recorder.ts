import type { ValidHostOptions } from "#core/hosts/host.ts"
import type { CommandRecorder } from "#core/session/recorder/commands.ts"
import { createRecordingTransport } from "#core/session/recorder/commands.ts"
import { getFailureHints } from "#core/session/recorder/failure-hints.ts"
import type { HostRecord } from "#core/session/recorder/records.ts"
import type { Transport } from "#core/transport.ts"
import type { Shell } from "#core/transport/shell.ts"
import { createShell } from "#core/transport/shell.ts"

/** Records a host's preparation, before its script runs: the commands preparation runs, and its failure. */
export interface PreparationRecorder {
  /** Returns a shell on `transport` that records each command on the host's preparation. */
  getShell: (transport: Transport) => Shell
  /** Records `error` as the preparation's failure, with hints for it. */
  recordFailure: (error: Error) => void
}

/** Records a host's preparation on `hostRecord`. */
export const createPreparationRecorder = (
  hostRecord: HostRecord,
  hostOptions: ValidHostOptions,
): PreparationRecorder => {
  // Record the output as it is, because preparation never sees a secret.
  const commandRecorder: CommandRecorder = {
    recordCommand: (commandRecord) => {
      hostRecord.preparationCommands.push(commandRecord)
    },
    recordOutput: (commandRecord, output) => {
      commandRecord.output = output
    },
  }

  const getShell = (transport: Transport) => createShell(createRecordingTransport(transport, commandRecorder))

  // Record it as the host's first failure, because nothing else runs on the host before preparation finishes.
  const recordFailure = (error: Error) => {
    const hints = getFailureHints(hostRecord.target, hostOptions, hostRecord.preparationCommands)
    hostRecord.failure = { kind: "preparation", error, hints }
  }

  return { getShell, recordFailure }
}
