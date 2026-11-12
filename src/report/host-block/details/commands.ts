import type { Detail, StepCommand } from "#report/host-block/host-block.ts"
import type { Verbosity } from "#report/verbosity.ts"
import type { CommandRecord, StepKind, StepRecord } from "#session/session.ts"

// List the commands from level 2, because they say how the work was done, which matters only when looking closely.
const COMMANDS_LEVEL: Verbosity = 2

// List no commands for a read or an inspect, because its name is its command.
const LISTS_COMMANDS: Record<StepKind, boolean> = {
  read: false,
  inspect: false,
  file: true,
  link: true,
  ensure: true,
  run: true,
}

const toStepCommand = ({ cmd, label }: CommandRecord): StepCommand => (label === undefined ? { cmd } : { cmd, label })

/** Returns `commandRecords` as one commands detail, in the order they ran, or none when there are none. */
export const toCommandsDetail = (commandRecords: CommandRecord[]): Detail[] => {
  const commands = commandRecords.map((commandRecord) => toStepCommand(commandRecord))
  return commands.length > 0 ? [{ kind: "commands", commands, from: COMMANDS_LEVEL }] : []
}

/** Returns the commands a step ran as one detail, or none for a step whose kind lists none. */
export const toCommandsDetails = (stepRecord: StepRecord): Detail[] =>
  LISTS_COMMANDS[stepRecord.kind] ? toCommandsDetail(stepRecord.commands) : []
