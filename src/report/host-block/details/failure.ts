import { isErr } from "ts-explicit-errors"

import { toComparisonValuesDetails } from "#report/host-block/details/comparisons.ts"
import type { Detail, StillDiffersPhase } from "#report/host-block/host-block.ts"
import type { CommandRecord, StepRecord } from "#session/session.ts"

// Look at what the fix did and what the last compare saw, because the failure is about the state after the fix.
// Leave out `before`, because it ran earlier, so it can't explain that state.
const STILL_DIFFERS_PHASES = ["fix", "after"] as const satisfies StillDiffersPhase[]

const getCommandStderr = (commandRecord: CommandRecord): string | undefined => {
  const { output } = commandRecord
  if (output === undefined || isErr(output)) return undefined

  return output.stderr.trim() || undefined
}

/**
 * Returns the stderr that can explain a step that still differs, from one phase. A phase with one command shows that
 * command's stderr, because it's clear what it relates to. A phase with several can't say which one matters, so it only
 * gets a note. A command tsinfra wrote itself never counts, because its code already handled what it printed.
 */
const toPhaseStderrDetails = (commandRecords: CommandRecord[], phase: StillDiffersPhase): Detail[] => {
  const phaseCommandRecords = commandRecords.filter(
    (commandRecord) => commandRecord.phase === phase && commandRecord.label === undefined,
  )

  if (phaseCommandRecords.length > 1) {
    const hasStderr = phaseCommandRecords.some((commandRecord) => getCommandStderr(commandRecord) !== undefined)
    // Leave the note out from level 3, because each command's stderr shows under it there.
    return hasStderr ? [{ kind: "note", note: { kind: "commandsWroteStderr", phase }, from: 0, until: 2 }] : []
  }

  const [onlyCommandRecord] = phaseCommandRecords
  const stderr = onlyCommandRecord && getCommandStderr(onlyCommandRecord)
  return onlyCommandRecord && stderr ? [{ kind: "stderr", command: onlyCommandRecord.cmd, stderr, from: 0 }] : []
}

/** Returns what a failed step found: the values that still differ and their stderr, or the values before the fix. */
export const toFailedStepDetails = (stepRecord: StepRecord): Detail[] => {
  const { commands, comparisons } = stepRecord
  const { before, after } = comparisons

  if (after) {
    // Show nothing for a compare that came back in sync, because a failure the script caught is what failed the step.
    if (after.inSync) return []

    const stderrDetails = STILL_DIFFERS_PHASES.flatMap((phase) => toPhaseStderrDetails(commands, phase))
    return [...toComparisonValuesDetails(after.values, 0), ...stderrDetails]
  }

  // Show the state from before the fix only from level 1, because the error already says what went wrong.
  // Label it, because it may no longer be true.
  if (before && !before.inSync) {
    return [
      { kind: "note", note: { kind: "valuesBeforeFix" }, from: 1 },
      ...toComparisonValuesDetails(before.values, 1),
    ]
  }

  return []
}
