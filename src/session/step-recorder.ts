import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { StepKind, StepOutcome } from "#session/step.ts"
import type { CommandOutput, Transport } from "#transport/transport.ts"

interface CommandRecord {
  cmd: string
  /** Unset until the command finishes. */
  output?: Result<CommandOutput>
}

export interface StepRecord {
  /** The name the script gave the step, or a read step's command. */
  name: string
  kind: StepKind
  commands: CommandRecord[]
  /** Unset until the step finishes. */
  outcome?: Result<StepOutcome>
}

interface StepRecorder {
  /** Every step that started, in the order the script called them. */
  stepRecords: StepRecord[]
  /** Wraps `transport` so each command is recorded under the running step. */
  recordCommands: (transport: Transport) => Transport
  /** Records a new step and marks it running, or fails when another step is running. */
  startStep: (stepName: string, kind: StepKind) => Result<StepRecord>
  /** Records the step's outcome or error, and marks no step as running. */
  finishStep: (stepRecord: StepRecord, outcome: Result<StepOutcome>) => void
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
  const startStep = (stepName: string, kind: StepKind): Result<StepRecord> => {
    if (currentStep) {
      const { name, kind: runningKind } = currentStep
      return err(`'${kind}' can't run while ${runningKind} step '${name}' is running`, undefined)
    }

    const stepRecord: StepRecord = { name: stepName, kind, commands: [] }
    stepRecords.push(stepRecord)
    currentStep = stepRecord
    return stepRecord
  }

  const finishStep = (stepRecord: StepRecord, outcome: Result<StepOutcome>) => {
    stepRecord.outcome = outcome
    currentStep = undefined
  }

  return { stepRecords, recordCommands, startStep, finishStep }
}
