import type { Detail, StepCommand } from "#report/host-block/host-block.ts"
import type { Verbosity } from "#report/verbosity.ts"
import type { CommandRecord, StepKind, StepRecord } from "#session/session.ts"

// List the commands from level 2, because they say how a step did its work, which matters only when looking closely.
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

/** Returns the commands a step ran, in the order they ran, as one detail, or none when it lists none. */
export const toCommandsDetails = (stepRecord: StepRecord): Detail[] => {
  const { kind, commands: commandRecords } = stepRecord
  const commands = commandRecords.map((commandRecord) => toStepCommand(commandRecord))

  return LISTS_COMMANDS[kind] && commands.length > 0 ? [{ kind: "commands", commands, from: COMMANDS_LEVEL }] : []
}
