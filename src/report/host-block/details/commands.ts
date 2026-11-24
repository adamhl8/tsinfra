import { isErr } from "ts-explicit-errors"

import type { CommandRecord, StepRecord } from "#core/session/recorder/records.ts"
import type { StepKind } from "#core/session/step.ts"
import type { CommandOutputDetail, Detail, StepCommand } from "#report/host-block.ts"
import { toStepOptions } from "#report/host-block/details/options.ts"
import type { Verbosity } from "#report/verbosity.ts"

// List the commands and the step messages among them from level 2, because they say how the work was done, which
// matters only when looking closely.
export const COMMANDS_LEVEL: Verbosity = 2
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
 * Returns a command with the tool whose call ran it and the options that call set, and what it printed as a piece of
 * its own, from level 3, when each was recorded.
 */
const toStepCommand = (commandRecord: CommandRecord): StepCommand => {
  const { cmd, label, toolCall, phase, output } = commandRecord
  const options = toolCall === undefined ? [] : toStepOptions(toolCall.options)
  const outputPiece = output && { ...toCommandOutputDetail(output), from: OUTPUT_LEVEL }
  return { cmd, label, toolName: toolCall?.toolName, options, phase, output: outputPiece }
}

/** Returns `commandRecords` as one commands detail, in the order they ran, with phase headings from level 3. */
export const toCommandsDetail = (commandRecords: CommandRecord[]): Detail => {
  const commands = commandRecords.map((commandRecord) => toStepCommand(commandRecord))
  return { kind: "commands", commands, phaseHeadings: { from: OUTPUT_LEVEL }, from: COMMANDS_LEVEL }
}

/**
 * Returns the commands a step ran as one detail. A read or inspect step lists none, so it gets what its one command
 * printed instead, from level 3.
 */
export const toCommandsDetails = (stepRecord: StepRecord): Detail[] => {
  const { kind, commands, messages } = stepRecord
  if (LISTS_COMMANDS[kind]) {
    // Give a step that only logged the detail too, because its step messages show among its commands.
    const isListed = commands.length > 0 || messages.length > 0
    return isListed ? [toCommandsDetail(commands)] : []
  }

  const outputs = commands.flatMap(({ output }) => (output === undefined ? [] : [output]))
  return outputs.map((output) => ({ kind: "commandOutput", output: toCommandOutputDetail(output), from: OUTPUT_LEVEL }))
}
