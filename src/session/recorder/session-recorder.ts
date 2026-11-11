import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { ValidHostOptions } from "#hosts/hosts.ts"
import type { Comparison } from "#session/handlers/handlers.ts"
import { createRecordingTransport } from "#session/recorder/commands.ts"
import { getFailureHints } from "#session/recorder/failure-hints.ts"
import type { ConvergePhase, HostRecord, StepRecord } from "#session/recorder/records.ts"
import type { StepKind, StepStatus } from "#session/step.ts"
import type { Shell, Transport } from "#transport/transport.ts"
import { createShell, createRootTransport } from "#transport/transport.ts"

/** Returns a shell that records each command under the running step, and runs as root for `sudo: true`. */
type GetShell = (options: { sudo: boolean }) => Shell

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

/** Records the session's part of a host's run, once preparation has finished: each step, and the host's failure. */
export interface SessionRecorder {
  /** Gives the session its shells, so nothing in the session runs a command off the record. */
  getShell: GetShell
  /** Returns the error the host failed with, or nothing while it hasn't failed. */
  getFailure: () => Error | undefined
  /**
   * Keeps `error` as the host's failure, and returns the error the host ends up with. A new failure is the host
   * function's, until a step that was running makes it its own when it finishes.
   */
  recordFailure: (error: Error) => Error
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

/**
 * Records a host's session on `hostRecord`, running its commands on `transport`, the host's final transport. Keeps
 * `transport` to itself, so the session can only reach it through shells that record.
 */
export const createSessionRecorder = (
  hostRecord: HostRecord,
  hostOptions: ValidHostOptions,
  transport: Transport,
): SessionRecorder => {
  let currentStep: StepRecord | undefined
  let currentPhase: ConvergePhase | undefined

  const getShell: GetShell = ({ sudo }) => {
    const stepTransport = sudo ? createRootTransport(transport) : transport

    // Record above the root transport, so the record holds the step's script without the `sudo sh -s` around it.
    // Stamp the phase before the command runs, because a reader wants to know when a command started.
    const recordingTransport = createRecordingTransport(stepTransport, (commandRecord) => {
      if (currentPhase) commandRecord.phase = currentPhase
      currentStep?.commands.push(commandRecord)
    })

    return createShell(recordingTransport)
  }

  // Keep the first failure's error, because calls made at once with `Promise.all` can each fail.
  // Replace it only with an error that wraps it, which adds context such as the step's name.
  const keepError = (error: Error): Error => {
    const keptError = hostRecord.failure?.error
    return keptError === undefined || error.cause === keptError ? error : keptError
  }

  const recordFailure = (error: Error): Error => {
    const { failure } = hostRecord
    // Keep an existing failure's kind, and only update its error, because the failure is already where it came from.
    // `callOrFail` records again the error a step's failure already holds, and calls made at once can each fail.
    if (failure) {
      failure.error = keepError(error)
      return failure.error
    }

    hostRecord.failure = { kind: "host fn", error, hints: [] }
    return error
  }

  // Work out the hints when the step is done, from all of its commands.
  const recordStepFailure = (stepRecord: StepRecord, error: Error) => {
    const hints = getFailureHints(hostRecord.target, hostOptions, stepRecord.commands)
    hostRecord.failure = { kind: "step", stepRecord, error: keepError(error), hints }
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

  const getFailure = () => hostRecord.failure?.error

  return { getShell, getFailure, recordFailure, startStep, finishStep, failStep, convergeRecorder }
}
