import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { Comparison } from "#session/handlers/shared/converge.ts"
import type { StepKind, StepStatus } from "#session/step.ts"
import type { CommandOutput, Transport } from "#transport/transport.ts"

/** The parts of `converge` that run commands, in order. */
export type ConvergePhase = "before" | "fix" | "after"

/** The phases of `converge` that compare the host with what the step wants. */
export type ComparePhase = Exclude<ConvergePhase, "fix">

export interface CommandOptions {
  /** A short name for a command tsinfra wrote itself. */
  label?: string
  /** The text to record in place of the command, for one that holds content. */
  recordedCmd?: string
}

/** Runs a command like a `Transport`, and also takes what the recorder needs to know about it. */
export type RecordingTransport = (cmd: string, options?: CommandOptions) => Promise<Result<CommandOutput>>

export interface CommandRecord {
  cmd: string
  /** A short name for a command tsinfra wrote itself. Unset for a script's command. */
  label?: string
  /** The part of `converge` that ran the command. Unset for a step that doesn't converge. */
  phase?: ConvergePhase
  /** Unset until the command finishes. */
  output?: Result<CommandOutput>
}

interface StepComparisons {
  before?: Comparison
  after?: Comparison
}

export interface StepRecord {
  /** The name the script gave the step, or a read step's command. */
  name: string
  kind: StepKind
  /** Unset until the step finishes, and an error if it failed. */
  status?: Result<StepStatus>
  commands: CommandRecord[]
  comparisons: StepComparisons
  /** The names of the needed steps this step waited on. */
  waitingOn: string[]
}

/** What `converge` uses to record what it does, so a step's handler never records anything itself. */
export interface ConvergeRecorder {
  /** Marks the part of `converge` that commands run under from now on. */
  startPhase: (phase: ConvergePhase) => void
  /** Records what a compare found on the running step. */
  recordComparison: (phase: ComparePhase, comparison: Comparison) => void
  /** Records the names of the needed steps the running step waited on. */
  recordWaitingOn: (stepNames: string[]) => void
}

export interface StepRecorder {
  /** Every step that started, in the order the script called them. */
  stepRecords: StepRecord[]
  /** Wraps `transport` so each command is recorded under the running step. */
  recordCommands: (transport: Transport) => RecordingTransport
  /** Records a new step and marks it running, or fails when another step is running. */
  startStep: (stepName: string, kind: StepKind) => Result<StepRecord>
  /** Records the step's status or error, and marks no step as running. */
  finishStep: (stepRecord: StepRecord, status: Result<StepStatus>) => void
  convergeRecorder: ConvergeRecorder
}

/** Tracks the running step for one host, and records each step and what happens during it. */
export const createStepRecorder = (): StepRecorder => {
  const stepRecords: StepRecord[] = []
  let currentStep: StepRecord | undefined
  let currentPhase: ConvergePhase | undefined

  // Push the record before the command runs, so commands run at once keep the order they were called in.
  // Stamp the phase now too, because a reader wants to know when a command started.
  const recordCommands =
    (transport: Transport): RecordingTransport =>
    async (cmd, options = {}) => {
      const { label, recordedCmd = cmd } = options
      const commandRecord: CommandRecord = {
        cmd: recordedCmd,
        ...(label !== undefined && { label }),
        ...(currentPhase && { phase: currentPhase }),
      }
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

    const stepRecord: StepRecord = { name: stepName, kind, commands: [], comparisons: {}, waitingOn: [] }
    stepRecords.push(stepRecord)
    currentStep = stepRecord
    return stepRecord
  }

  const finishStep = (stepRecord: StepRecord, status: Result<StepStatus>) => {
    stepRecord.status = status
    currentStep = undefined
    currentPhase = undefined
  }

  const startPhase = (phase: ConvergePhase) => {
    currentPhase = phase
  }

  const recordComparison = (phase: ComparePhase, comparison: Comparison) => {
    if (currentStep) currentStep.comparisons[phase] = comparison
  }

  const recordWaitingOn = (stepNames: string[]) => {
    if (currentStep) currentStep.waitingOn = stepNames
  }

  const convergeRecorder: ConvergeRecorder = { startPhase, recordComparison, recordWaitingOn }

  return { stepRecords, recordCommands, startStep, finishStep, convergeRecorder }
}
