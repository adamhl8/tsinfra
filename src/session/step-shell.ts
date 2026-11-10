import type { StepRecorder } from "#session/recorder/recorder.ts"
import type { Shell, Transport } from "#transport/transport.ts"
import { createShell, createRootTransport } from "#transport/transport.ts"

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
