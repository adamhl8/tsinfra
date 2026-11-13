import { isErr } from "ts-explicit-errors"

import type { CommandOutputDetail, Detail, StepCommand } from "#report/host-block/host-block.ts"
import type { Verbosity } from "#report/verbosity.ts"
import type { CommandRecord, StepKind, StepRecord } from "#session/session.ts"

// List the commands from level 2, because they say how the work was done, which matters only when looking closely.
const COMMANDS_LEVEL: Verbosity = 2
// Show what each command printed from level 3, because it's the most detail there is, for when something looks wrong.
const OUTPUT_LEVEL: Verbosity = 3

// List no commands for a read or an inspect, because its name is its command.
const LISTS_COMMANDS: Record<StepKind, boolean> = {
  read: false,
  inspect: false,
  file: true,
  link: true,
  ensure: true,
  run: true,
}

/** Returns what a command printed: its exit code and both streams, or the error it failed with when it couldn't run. */
const toCommandOutputDetail = (output: NonNullable<CommandRecord["output"]>): CommandOutputDetail => {
  if (isErr(output)) return { kind: "failed", error: output }

  const { exitCode, stdout, stderr } = output
  return { kind: "exited", exitCode, stdout, stderr }
}

/** Returns a command with what it printed as a piece of its own, from level 3, when its output was recorded. */
const toStepCommand = ({ cmd, label, output }: CommandRecord): StepCommand => ({
  cmd,
  ...(label !== undefined && { label }),
  ...(output !== undefined && { output: { ...toCommandOutputDetail(output), from: OUTPUT_LEVEL } }),
})

/** Returns `commandRecords` as one commands detail, in the order they ran, or none when there are none. */
export const toCommandsDetail = (commandRecords: CommandRecord[]): Detail[] => {
  const commands = commandRecords.map((commandRecord) => toStepCommand(commandRecord))
  return commands.length > 0 ? [{ kind: "commands", commands, from: COMMANDS_LEVEL }] : []
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
