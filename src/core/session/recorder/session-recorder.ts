import { deepEqual } from "fast-equals"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { ValidHostOptions } from "#core/hosts/host.ts"
import type { MessageKind } from "#core/session/handlers/log.ts"
import type { ValidStepShellOptions } from "#core/session/handlers/options/step.ts"
import type { Comparison } from "#core/session/handlers/shared/converge.ts"
import type { GetToolShell, ToolName, ValidToolOptions } from "#core/session/handlers/tools.ts"
import type { HostMeta } from "#core/session/host-meta.ts"
import { getFailureHints } from "#core/session/recorder/failure-hints.ts"
import { addSecret, maskSecrets } from "#core/session/recorder/masking.ts"
import type {
  CommandRecord,
  ConvergePhase,
  HostRecord,
  SessionFailureKind,
  StepOptionsRecord,
  StepOptionsToRecord,
  StepMessageRecord,
  StepRecord,
  ToolCallRecord,
} from "#core/session/recorder/records.ts"
import { RECORDED_OPTION_DEFAULTS, RECORDED_STAND_INS } from "#core/session/recorder/records.ts"
import type { StepKind, StepStatus } from "#core/session/step.ts"
import type { Transport } from "#core/transport.ts"
import type { CommandRecorder, RecordOutput, Shell } from "#core/transport/shell.ts"
import { createShell } from "#core/transport/shell.ts"

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
  /**
   * Returns a shell for one tool call, which records the call on its command. It runs with the step's variables, then
   * the call's, so the call's value wins for a name both set. It never runs as root, because no tool takes `sudo`.
   */
  getToolShell: GetToolShell
}

// Look each default and stand-in up by an option's name, because most options have neither.
const OPTION_DEFAULTS = new Map<string, unknown>(Object.entries(RECORDED_OPTION_DEFAULTS))
const OPTION_STAND_INS = new Map<string, string>(Object.entries(RECORDED_STAND_INS))

/**
 * Returns the options the record holds: each one that's set and not at its default, as given or as its stand-in. The
 * record holds only what a step or a tool call set.
 */
const toRecordedOptions = (options: StepOptionsToRecord): StepOptionsRecord => {
  const setEntries = Object.entries(options).filter(
    ([name, value]) => value !== undefined && !deepEqual(value, OPTION_DEFAULTS.get(name)),
  )
  const recordedEntries = setEntries.map(([name, value]): [string, unknown] => [
    name,
    OPTION_STAND_INS.get(name) ?? value,
  ])
  // Return the result unchecked, because `Object.fromEntries` loses the keys' types.
  // TypeScript accepts it as `StepOptionsRecord` only because every option is optional.
  // Each entry is still an option the record holds, as given or as its stand-in.
  return Object.fromEntries(recordedEntries)
}

/** Records the session's part of a host's run, once preparation has finished: each step, and the host's failure. */
export interface SessionRecorder {
  /**
   * Records the shell options the running step set, and returns its shells, built once for the step. Recording and
   * building in one call keeps the record and the commands from disagreeing.
   */
  getStepShells: (options: ValidStepShellOptions) => StepShells
  /**
   * Records `options` on the running step, after any it already has, masked, and leaves out each one at its default.
   * Records an option like `input` as its stand-in. A step's handler calls it right after validating its options, so a
   * failure can't lose them.
   */
  recordOptions: (options: StepOptionsToRecord) => void
  /** Returns the error the host failed with, or nothing while it hasn't failed. */
  getFailure: () => Error | undefined
  /**
   * Keeps `error` as the host's failure, and returns the error the host ends up with. A new failure is of `kind`, until
   * a step that was running makes it its own when it finishes.
   */
  recordFailure: (error: Error, kind: SessionFailureKind) => Error
  /** Records a new step and marks it running, or fails when another step is running. */
  startStep: (stepName: string, kind: StepKind) => Result
  /**
   * Records the running step's status, and marks no step as running. Fails the step instead when the host failed while
   * it ran.
   */
  finishStep: (status: StepStatus) => void
  /** Fails the running step with `error`, and marks no step as running. */
  failStep: (error: Error) => void
  /**
   * Records a message the script logged, masked. Records it on the running step, with its phase and its place among the
   * step's commands, or as an entry of its own when no step is running.
   */
  recordMessage: (messageKind: MessageKind, text: string) => void
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
  meta: HostMeta,
): SessionRecorder => {
  let currentPhase: ConvergePhase | undefined
  const secrets = new Set<string>()

  // Mask the sudo password before any step, because the script can pass it to a command through `h.meta`.
  if (meta.sudoPassword !== undefined) addSecret(secrets, meta.sudoPassword)

  const mask = <T>(value: T): T => maskSecrets(value, secrets)

  /** Returns a command recorder that records each command under the running step, with `toolCallRecord` when given. */
  const createCommandRecorder = (toolCallRecord?: ToolCallRecord): CommandRecorder => ({
    recordCommand: (shellCommand) => {
      const cmd = mask(shellCommand.cmd)
      const commandRecord: CommandRecord = { ...shellCommand, cmd }
      if (toolCallRecord) commandRecord.toolCall = toolCallRecord
      // Stamp the phase before the command runs, because a reader wants to know when a command started.
      if (currentPhase) commandRecord.phase = currentPhase
      hostRecord.runningStep?.commands.push(commandRecord)

      const recordOutput: RecordOutput = (output, maskOutput) => {
        // Add the trimmed stdout, because that's what the `read` tool returns to the script.
        if (maskOutput && !isErr(output)) addSecret(secrets, output.stdout.trim())
        commandRecord.output = mask(output)
      }
      return recordOutput
    },
  })

  const recordOptions = (_options: StepOptionsToRecord) => {
    const options = mask(toRecordedOptions(_options))
    if (hostRecord.runningStep) hostRecord.runningStep.options = { ...hostRecord.runningStep.options, ...options }
  }

  const getStepShells = (shellOptions: ValidStepShellOptions): StepShells => {
    const { sudo, env, secretEnv } = shellOptions
    const secretValues = Object.values(secretEnv)
    for (const value of secretValues) addSecret(secrets, value)

    const variables = { ...env, ...secretEnv }
    const stepShell = createShell(transport, { sudo, variables, commandRecorder: createCommandRecorder() })

    recordOptions(shellOptions)

    const getToolShell = (toolName: ToolName, _toolOptions: ValidToolOptions): Shell => {
      const { env: toolEnv, secretEnv: toolSecretEnv } = _toolOptions
      const toolSecretValues = Object.values(toolSecretEnv)
      for (const value of toolSecretValues) addSecret(secrets, value)

      const options = mask(toRecordedOptions(_toolOptions))
      const toolCallRecord: ToolCallRecord = { toolName, options }

      const toolVariables = { ...variables, ...toolEnv, ...toolSecretEnv }
      return createShell(transport, {
        sudo: false,
        variables: toolVariables,
        commandRecorder: createCommandRecorder(toolCallRecord),
      })
    }

    return { stepShell, getToolShell }
  }

  // Keep the first failure's error, because calls made at once with `Promise.all` can each fail.
  // Replace it only with an error that wraps it, which adds context such as the step's name.
  const keepError = (error: Error): Error => {
    const keptError = hostRecord.failure?.error
    return keptError === undefined || error.cause === keptError ? error : keptError
  }

  const recordFailure = (_error: Error, kind: SessionFailureKind): Error => {
    const error = mask(_error)
    const { failure } = hostRecord
    // Keep an existing failure's kind, and only update its error, because the failure is already where it came from.
    // `callOrFail` records again the error a step's failure already holds, and calls made at once can each fail.
    if (failure) {
      failure.error = keepError(error)
      return failure.error
    }

    hostRecord.failure = { kind, error, hints: [] }
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

    hostRecord.runningStep = {
      name: stepName,
      kind,
      options: {},
      commands: [],
      comparisons: {},
      waitingOn: [],
      messages: [],
    }
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
    else hostRecord.entries.push({ ...stepRecord, status })
  }

  const failStep = (error: Error) => {
    const stepRecord = endStep()
    if (stepRecord) recordStepFailure(stepRecord, error)
  }

  const recordMessage = (messageKind: MessageKind, _text: string) => {
    const text = mask(_text)
    const { runningStep } = hostRecord
    if (!runningStep) {
      hostRecord.entries.push({ kind: "hostMessage", messageKind, text })
      return
    }

    const commandCount = runningStep.commands.length
    const stepMessageRecord: StepMessageRecord = {
      messageKind,
      text,
      ...(currentPhase && { phase: currentPhase }),
      commandCount,
    }
    runningStep.messages.push(stepMessageRecord)
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

  return {
    getStepShells,
    recordOptions,
    getFailure,
    recordFailure,
    startStep,
    finishStep,
    failStep,
    recordMessage,
    convergeRecorder,
  }
}
