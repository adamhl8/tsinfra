import type { ValidHostOptions } from "#hosts/hosts.ts"
import { createRecordingTransport } from "#session/recorder/commands.ts"
import { getFailureHints } from "#session/recorder/failure-hints.ts"
import type { HostRecord } from "#session/recorder/records.ts"
import type { Shell, Transport } from "#transport/transport.ts"
import { createShell } from "#transport/transport.ts"

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
  const getShell = (transport: Transport) =>
    createShell(
      createRecordingTransport(transport, (commandRecord) => {
        hostRecord.preparationCommands.push(commandRecord)
      }),
    )

  // Record it as the host's first failure, because nothing else runs on the host before preparation finishes.
  const recordFailure = (error: Error) => {
    const hints = getFailureHints(hostRecord.target, hostOptions, hostRecord.preparationCommands)
    hostRecord.failure = { kind: "preparation", error, hints }
  }

  return { getShell, recordFailure }
}
