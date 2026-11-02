import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { HostEntry } from "#hosts/load.ts"
import { createShell } from "#session/shell.ts"
import type { Change } from "#session/step-functions/change.ts"
import type { Exec, ChangeTools, CheckTools } from "#session/step-functions/tools.ts"
import { handleExec } from "#session/step-functions/tools.ts"
import type { StepRecord } from "#session/step-records.ts"
import { createStepRecorder } from "#session/step-records.ts"
import type { StepCall, StepDetails, StepResult } from "#session/step.ts"
import { stepResultSchema } from "#session/step.ts"
import type { EnsureOptions } from "#session/steps/ensure.ts"
import { handleEnsure } from "#session/steps/ensure.ts"
import type { CommandResult, Inspect } from "#session/steps/inspect.ts"
import { handleInspect } from "#session/steps/inspect.ts"
import type { Read } from "#session/steps/read.ts"
import { handleRead } from "#session/steps/read.ts"
import type { RunOptions } from "#session/steps/run.ts"
import { handleRun } from "#session/steps/run.ts"
import { getTransport } from "#transport/transport.ts"

/** What a host's function is given. Each method call is one step, and steps run one at a time at the top level. */
export interface Host {
  readonly name: string
  /**
   * Runs `cmd` on the host and returns its stdout, trimmed. It must not change anything, because it also runs during
   * `plan`.
   *
   * A non-zero exit fails the host and throws. Catching it does not recover the host. Use `inspect` when a non-zero
   * exit is a legitimate answer.
   */
  read: Read
  /**
   * Runs `cmd` on the host and returns its stdout and stderr, both trimmed, and its exit code. It must not change
   * anything, because it also runs during `plan`.
   *
   * A non-zero exit is an answer, not a failure. Only a command that can't run at all fails the host and throws.
   */
  inspect: Inspect
  /**
   * Compares what `check` gives to `want`, and in `apply` runs `fix` when they differ, then checks again. In `plan` the
   * fix never runs.
   *
   * A failing fix, or a check that still differs after it, fails the host and throws.
   */
  ensure: <T extends string | boolean>(name: string, options: EnsureOptions<T>) => Promise<StepResult>
  /**
   * Runs `cmd`, a command or a function given `exec`, when a step in `after` changed, or on every pass with `after:
   * "always"`. There is no check, so it never counts as drift. In `plan` it never runs, and reports changed when it
   * would.
   *
   * A failing command fails the host and throws.
   */
  run: (name: string, cmd: Change, options: RunOptions) => Promise<StepResult>
}

export type StepKind = Exclude<keyof Host, "name">

type Failure = Error | undefined

// Keep the first failure, because calls made at once with `Promise.all` can each fail.
// Replace it only with an error that wraps it, which adds context such as the step's name.
const keepFailure = (failure: Failure, error: Error) =>
  failure === undefined || error.cause === failure ? error : failure

export interface HostSession {
  host: Host
  /** Every step that started, in the order the script called them. */
  stepRecords: StepRecord[]
  getFailure: () => Failure
}

/**
 * Builds the `Host` passed to a host's function, and tracks the run's failure where the script can't see it.
 *
 * This is the only code that throws, because throwing is the contract with the script. Every function the script can
 * call, on `h` or as `read` and `exec`, goes through `callOrFail` around an internal function from `steps/` or
 * `tools.ts` that returns errors as values.
 */
export const createHostSession = (hostEntry: HostEntry, mode: Mode): HostSession => {
  const { name, target } = hostEntry
  let failure: Failure

  // Throw the failure on every later call, so a script that catches it still can't use the host.
  // Type `fail` itself, not just its return, so TypeScript knows nothing runs after a call to it.
  const fail: (error: Error) => never = (error) => {
    failure = keepFailure(failure, error)
    throw failure
  }

  // oxlint-disable-next-line promise/prefer-await-to-callbacks - `callback` is awaited, and the rule only matches its name
  const callOrFail = async <T>(callback: () => Promise<Result<T>>) => {
    if (failure) throw failure

    // oxlint-disable-next-line promise/prefer-await-to-callbacks - `callback` is awaited, and the rule only matches its name
    const value = await callback()
    if (isErr(value)) fail(value)

    // Throw a failure recorded during `callback`, because a function in the script may have caught it and returned normally.
    // Widen `failure` with `as`, because TypeScript keeps the narrowing to `undefined` from the check above.
    // TypeScript can't know that `callback` may have set `failure` again.
    const callbackFailure = failure as Failure
    if (callbackFailure) throw callbackFailure
    return value
  }

  const { stepRecords, recordCommands, startStep, finishStep } = createStepRecorder()

  // Record each command under the running step, because every command passes through the transport.
  const shell = createShell(recordCommands(getTransport(target)))
  const readTool: Read = async (cmd) => callOrFail(async () => handleRead(shell, cmd))
  const inspectTool: Inspect = async (cmd) => callOrFail(async () => handleInspect(shell, cmd))
  const execTool: Exec = async (cmd) => callOrFail(async () => handleExec(shell, cmd))
  const checkTools: CheckTools = { read: readTool, inspect: inspectTool }
  const changeTools: ChangeTools = { exec: execTool, inspect: inspectTool }

  const callStep = async (
    kind: StepKind,
    stepName: string,
    handler: (stepCall: StepCall) => Promise<Result<StepDetails>>,
  ) =>
    callOrFail(async () => {
      const stepRecord = startStep(kind, stepName)
      if (isErr(stepRecord)) return stepRecord

      const stepDetails = await handler({ shell, mode, stepName, checkTools, changeTools })

      // Record the failure the host ends up with, because a function in the script may have caught an earlier one.
      const stepFailure = isErr(stepDetails) ? keepFailure(failure, stepDetails) : failure
      finishStep(stepRecord, stepFailure ?? stepDetails)
      if (isErr(stepDetails)) return stepDetails

      const stepResult = stepResultSchema(stepDetails)
      if (stepResult instanceof type.errors)
        return err(`failed to report step '${stepName}'`, err(stepResult.summary, undefined))

      return stepResult
    })

  const read: Host["read"] = async (cmd) => {
    // Keep the stdout here, because a step reports only its details.
    let stdout = ""
    // Pass `cmd` as the step name, because `h.read` takes no name.
    await callStep("read", cmd, async () => {
      const output = await handleRead(shell, cmd)
      if (isErr(output)) return output

      stdout = output
      return { status: "unchanged", changed: false }
    })
    return stdout
  }

  const inspect: Host["inspect"] = async (cmd) => {
    // Keep the result here, because a step reports only its details.
    // Start from an empty result, which is never returned, because `callStep` throws when the inspect fails.
    let commandResult: CommandResult = { stdout: "", stderr: "", exitCode: 0 }
    // Pass `cmd` as the step name, because `h.inspect` takes no name.
    await callStep("inspect", cmd, async () => {
      const result = await handleInspect(shell, cmd)
      if (isErr(result)) return result

      commandResult = result
      return { status: "unchanged", changed: false }
    })
    return commandResult
  }

  const ensure: Host["ensure"] = async (stepName, options) =>
    callStep("ensure", stepName, async (stepCall) => handleEnsure(stepCall, options))

  const run: Host["run"] = async (stepName, cmd, options) =>
    callStep("run", stepName, async (stepCall) => handleRun(stepCall, cmd, options))

  const host: Host = { name, read, inspect, ensure, run }

  return { host, stepRecords, getFailure: () => failure }
}
