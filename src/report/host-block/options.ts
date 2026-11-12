import type { EntryOption } from "#report/host-block/host-block.ts"
import type { StepRecord } from "#session/session.ts"

/** Returns the options a step ran with that are worth showing: `sudo` when every command ran as root. */
export const toStepOptions = (stepRecord: StepRecord): EntryOption[] => {
  // Show `sudo` from level 1, because it says how the step ran, not what it changed.
  if (stepRecord.options.sudo) return [{ kind: "sudo", from: 1 }]

  return []
}
