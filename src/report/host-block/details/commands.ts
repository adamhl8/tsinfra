import { isErr } from "ts-explicit-errors"

import type { CommandRecord, StepRecord } from "#core/session/recorder/records.ts"
import type { StepKind } from "#core/session/step.ts"
import type { CommandGroup, CommandOutputDetail, Detail, StepCommand } from "#report/host-block.ts"
import type { Verbosity } from "#report/verbosity.ts"

// List the commands from level 2, because they say how the work was done, which matters only when looking closely.
const COMMANDS_LEVEL: Verbosity = 2
// Show what each command printed, and its phase, from level 3, because it's the most detail there is, for when
// something looks wrong.
const OUTPUT_LEVEL: Verbosity = 3

// List no commands for a read or an inspect, because its name is its command.
const LISTS_COMMANDS: Record<StepKind, boolean> = {
  read: false,
  inspect: false,
  file: true,
  link: true,
  dir: true,
  ensure: true,
  run: true,
}

/** Returns what a command printed: its exit code and both streams, or the error it failed with when it couldn't run. */
const toCommandOutputDetail = (output: NonNullable<CommandRecord["output"]>): CommandOutputDetail => {
  if (isErr(output)) return { kind: "failed", error: output }

  const { exitCode, stdout, stderr } = output
  return { kind: "exited", exitCode, stdout, stderr }
}

/**
 * Returns a command with the tool whose call ran it, and what it printed as a piece of its own, from level 3, when each
 * was recorded.
 */
const toStepCommand = ({ cmd, label, toolCall, output }: CommandRecord): StepCommand => ({
  cmd,
  ...(label !== undefined && { label }),
  ...(toolCall !== undefined && { toolName: toolCall.toolName }),
  ...(output !== undefined && { output: { ...toCommandOutputDetail(output), from: OUTPUT_LEVEL } }),
})

/**
 * Groups `commandRecords` by the phase that ran them, keeping the order they ran in, so a group starts wherever the
 * phase changes. Commands with no phase make one group with none. Each group's phase shows from level 3.
 */
const toCommandGroups = (commandRecords: CommandRecord[]): CommandGroup[] => {
  const groups: CommandGroup[] = []
  for (const commandRecord of commandRecords) {
    const { phase } = commandRecord
    const command = toStepCommand(commandRecord)
    const lastGroup = groups.at(-1)
    const isSamePhase = lastGroup !== undefined && lastGroup.phase?.phase === phase
    if (isSamePhase) lastGroup.commands.push(command)
    else groups.push({ ...(phase !== undefined && { phase: { phase, from: OUTPUT_LEVEL } }), commands: [command] })
  }
  return groups
}

/** Returns `commandRecords` as one commands detail, in the order they ran, or none when there are none. */
export const toCommandsDetail = (commandRecords: CommandRecord[]): Detail[] => {
  const groups = toCommandGroups(commandRecords)
  return groups.length > 0 ? [{ kind: "commands", groups, from: COMMANDS_LEVEL }] : []
}

/**
 * Returns the commands a step ran as one detail. A read or inspect step lists none, so it gets what its one command
 * printed instead, from level 3.
 */
export const toCommandsDetails = (stepRecord: StepRecord): Detail[] => {
  if (LISTS_COMMANDS[stepRecord.kind]) return toCommandsDetail(stepRecord.commands)

  const outputs = stepRecord.commands.flatMap(({ output }) => (output === undefined ? [] : [output]))
  return outputs.map((output) => ({ kind: "commandOutput", output: toCommandOutputDetail(output), from: OUTPUT_LEVEL }))
}
