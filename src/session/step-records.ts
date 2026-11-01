import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { StepKind } from "#session/session.ts"
import type { StepDetails } from "#session/step.ts"
import type { CommandResult, Transport } from "#transport/transport.ts"

interface CommandRecord {
  cmd: string
  /** Unset until the command finishes. */
  output?: Result<CommandResult>
}

export interface StepRecord {
  kind: StepKind
  /** The name the script gave the step, or a read's command. */
  name: string
  commands: CommandRecord[]
  /** Unset until the step finishes. */
  details?: Result<StepDetails>
}

interface StepRecorder {
  /** Every step that started, in the order the script called them. */
  stepRecords: StepRecord[]
  /** Wraps `transport` so each command is recorded under the running step. */
  recordCommands: (transport: Transport) => Transport
  /** Records a new step and marks it running, or fails when another step is running. */
  startStep: (kind: StepKind, stepName: string) => Result<StepRecord>
  /** Records the step's details or error, and marks no step as running. */
  finishStep: (stepRecord: StepRecord, details: Result<StepDetails>) => void
}

// Name a read by its command, because `h.read` takes no name.
const describeStep = (stepRecord: StepRecord) => {
  const { kind, name } = stepRecord
  return kind === "read" ? `read '${name}'` : `step '${name}'`
}

/** Tracks the running step for one host, and records each step and the commands it runs. */
export const createStepRecorder = (): StepRecorder => {
  const stepRecords: StepRecord[] = []
  let currentStep: StepRecord | undefined

  // Push the record before the command runs, so commands run at once keep the order they were called in.
  const recordCommands =
    (transport: Transport): Transport =>
    async (cmd) => {
      const commandRecord: CommandRecord = { cmd }
      currentStep?.commands.push(commandRecord)
      const output = await transport(cmd)
      commandRecord.output = output
      return output
    }

  // Fail a step that starts while another is running, because a step's functions use the tools they are given.
  // This also catches steps run at once with `Promise.all`.
  const startStep = (kind: StepKind, stepName: string): Result<StepRecord> => {
    if (currentStep) return err(`'${kind}' can't run while ${describeStep(currentStep)} is running`, undefined)

    const stepRecord: StepRecord = { kind, name: stepName, commands: [] }
    stepRecords.push(stepRecord)
    currentStep = stepRecord
    return stepRecord
  }

  const finishStep = (stepRecord: StepRecord, details: Result<StepDetails>) => {
    stepRecord.details = details
    currentStep = undefined
  }

  return { stepRecords, recordCommands, startStep, finishStep }
}
