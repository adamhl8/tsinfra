import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { ValidHostOptions } from "#hosts/hosts.ts"
import type { Comparison } from "#session/handlers/handlers.ts"
import type { CommandRecorder } from "#session/recorder/commands.ts"
import { createRecordingTransport } from "#session/recorder/commands.ts"
import { getFailureHints } from "#session/recorder/failure-hints.ts"
import { addSecret, maskSecrets } from "#session/recorder/masking.ts"
import type { ConvergePhase, HostRecord, StepRecord } from "#session/recorder/records.ts"
import type { StepKind, StepStatus } from "#session/step.ts"
import type { Shell, StepShellOptions, Transport } from "#transport/transport.ts"
import { createShell, createStepTransport } from "#transport/transport.ts"

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

/** A step's shells, which both record each command under the step. */
interface StepShells {
  /** Runs the step's own commands with its options. */
  stepShell: Shell
  /** Runs the tools' commands with the step's variables, and never as root, because no tool takes `sudo`. */
  toolShell: Shell
}

/** Records the session's part of a host's run, once preparation has finished: each step, and the host's failure. */
export interface SessionRecorder {
  /**
   * Records the running step's options, and returns its shells, built once for the step. Recording and building in one
   * call keeps the record and the commands from disagreeing.
   */
  getStepShells: (options: StepShellOptions) => StepShells
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
 * `transport` to itself, so the session can only reach it through shells that record. Masks every value it records with
 * the secrets the host knows so far, so the record never holds a secret.
 */
export const createSessionRecorder = (
  hostRecord: HostRecord,
  hostOptions: ValidHostOptions,
  transport: Transport,
): SessionRecorder => {
  let currentPhase: ConvergePhase | undefined
  const secrets = new Set<string>()
  const mask = <T>(value: T): T => maskSecrets(value, secrets)

  const commandRecorder: CommandRecorder = {
    recordCommand: (commandRecord) => {
      // Assign the masked `cmd` onto this record, because the recording transport passes this same record to
      // `recordOutput`.
      commandRecord.cmd = mask(commandRecord.cmd)
      // Stamp the phase before the command runs, because a reader wants to know when a command started.
      if (currentPhase) commandRecord.phase = currentPhase
      hostRecord.runningStep?.commands.push(commandRecord)
    },
    recordOutput: (commandRecord, output, { maskOutput }) => {
      // Add the trimmed stdout, because that's what the `read` tool returns to the script.
      if (maskOutput && !isErr(output)) addSecret(secrets, output.stdout.trim())
      commandRecord.output = mask(output)
    },
  }

  /** Returns a shell on `shellTransport` that records each command under the running step. */
  const createRecordingShell = (shellTransport: Transport): Shell =>
    createShell(createRecordingTransport(shellTransport, commandRecorder))

  const getStepShells = (_options: StepShellOptions): StepShells => {
    const secretValues = Object.values(_options.secretEnv)
    for (const value of secretValues) addSecret(secrets, value)
    // Record each command before the step transport adds the prelude and wraps it in `sudo sh -s`.
    // The record then holds the step's own script.
    const stepShell = createRecordingShell(createStepTransport(transport, _options))
    const toolShell = createRecordingShell(createStepTransport(transport, { ..._options, sudo: false }))

    const options = mask(_options)
    if (hostRecord.runningStep) hostRecord.runningStep.options = options

    return { stepShell, toolShell }
  }

  // Keep the first failure's error, because calls made at once with `Promise.all` can each fail.
  // Replace it only with an error that wraps it, which adds context such as the step's name.
  const keepError = (error: Error): Error => {
    const keptError = hostRecord.failure?.error
    return keptError === undefined || error.cause === keptError ? error : keptError
  }

  const recordFailure = (_error: Error): Error => {
    const error = mask(_error)
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

  // Fail a step that starts while another is running, because a step's functions use the tools they are given.
  // This also catches steps run at once with `Promise.all`.
  const startStep = (_stepName: string, kind: StepKind): Result => {
    // Mask the name, because a read step's name is its command.
    const stepName = mask(_stepName)
    const { runningStep } = hostRecord
    if (runningStep) {
      const { name, kind: runningKind } = runningStep
      return err(`'${kind}' can't run while ${runningKind} step '${name}' is running`, undefined)
    }

    // Start with empty options, so a step that fails its option check before getting its shells still has them.
    const options = { sudo: false, env: {}, secretEnv: {} }
    hostRecord.runningStep = { name: stepName, kind, options, commands: [], comparisons: {}, waitingOn: [] }
  }

  /** Marks no step as running, and returns the record of the step that was. */
  const endStep = () => {
    const { runningStep } = hostRecord
    hostRecord.runningStep = undefined
    currentPhase = undefined
    return runningStep
  }

  // Work out the hints when the step is done, from all of its commands.
  const recordStepFailure = (stepRecord: StepRecord, _error: Error) => {
    const error = mask(_error)
    const hints = getFailureHints(hostRecord.target, hostOptions, stepRecord.commands)
    hostRecord.failure = { kind: "step", stepRecord, error: keepError(error), hints }
  }

  const finishStep = (status: StepStatus) => {
    const stepRecord = endStep()
    if (!stepRecord) return

    // Fail the step when the host failed while it ran, because the script may have caught the failure, like a failed
    // `exec` in a fix. It still fails the host, and it belongs to this step.
    // Pass the host's own error, because there's no new one, and the keep rule leaves it as it is.
    if (hostRecord.failure) recordStepFailure(stepRecord, hostRecord.failure.error)
    else hostRecord.stepRecords.push({ ...stepRecord, status })
  }

  const failStep = (error: Error) => {
    const stepRecord = endStep()
    if (stepRecord) recordStepFailure(stepRecord, error)
  }

  const startPhase = (phase: ConvergePhase) => {
    currentPhase = phase
  }

  const recordComparison = (phase: ComparePhase, _comparison: Comparison) => {
    const comparison = mask(_comparison)
    if (hostRecord.runningStep) hostRecord.runningStep.comparisons[phase] = comparison
  }

  const recordWaitingOn = (_stepNames: string[]) => {
    const stepNames = mask(_stepNames)
    if (hostRecord.runningStep) hostRecord.runningStep.waitingOn = stepNames
  }

  const convergeRecorder: ConvergeRecorder = { startPhase, recordComparison, recordWaitingOn }

  const getFailure = () => hostRecord.failure?.error

  return { getStepShells, getFailure, recordFailure, startStep, finishStep, failStep, convergeRecorder }
}
