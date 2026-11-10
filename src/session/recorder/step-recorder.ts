import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { Comparison } from "#session/handlers/handlers.ts"
import type { CommandRecord, ConvergePhase, HostRecord, StepRecord } from "#session/recorder/records.ts"
import type { StepKind, StepStatus } from "#session/step.ts"
import type { RecordingTransport, Transport } from "#transport/transport.ts"

/** The phases of `converge` that compare the host with what the step wants. */
export type ComparePhase = Exclude<ConvergePhase, "fix">

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
  /** Wraps `transport` so each command is recorded under the running step. */
  recordCommands: (transport: Transport) => RecordingTransport
  /** Records a new step and marks it running, or fails when another step is running. */
  startStep: (stepName: string, kind: StepKind) => Result
  /**
   * Records the running step's status, and marks no step as running. Fails the step instead when the host failed while
   * it ran.
   */
  finishStep: (status: StepStatus) => void
  /** Fails the running step with `error`, and marks no step as running. */
  failStep: (error: Error) => void
  convergeRecorder: ConvergeRecorder
}

/** What a step recorder needs from its host's recorder. */
interface StepRecorderContext {
  hostRecord: HostRecord
  /**
   * Records `error` as the step's failure, with hints from its commands. Keeps an earlier failure's error instead,
   * unless `error` wraps it.
   */
  recordStepFailure: (stepRecord: StepRecord, error: Error) => void
}

/** Tracks the running step for one host, and records each step and what happens during it on the host's record. */
export const createStepRecorder = ({ hostRecord, recordStepFailure }: StepRecorderContext): StepRecorder => {
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
  const startStep = (stepName: string, kind: StepKind): Result => {
    if (currentStep) {
      const { name, kind: runningKind } = currentStep
      return err(`'${kind}' can't run while ${runningKind} step '${name}' is running`, undefined)
    }

    const stepRecord: StepRecord = {
      name: stepName,
      kind,
      commands: [],
      comparisons: {},
      waitingOn: [],
    }
    hostRecord.stepRecords.push(stepRecord)
    currentStep = stepRecord
  }

  /** Marks no step as running, and returns the record of the step that was. */
  const endStep = () => {
    const stepRecord = currentStep
    currentStep = undefined
    currentPhase = undefined
    return stepRecord
  }

  const finishStep = (status: StepStatus) => {
    const stepRecord = endStep()
    if (!stepRecord) return

    // Fail the step when the host failed while it ran, because the script may have caught the failure, like a failed
    // `exec` in a fix. It still fails the host, and it belongs to this step.
    // Pass the host's own error, because there's no new one, and the keep rule leaves it as it is.
    if (hostRecord.failure) recordStepFailure(stepRecord, hostRecord.failure.error)
    else stepRecord.status = status
  }

  const failStep = (error: Error) => {
    const stepRecord = endStep()
    if (stepRecord) recordStepFailure(stepRecord, error)
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

  return { recordCommands, startStep, finishStep, failStep, convergeRecorder }
}
