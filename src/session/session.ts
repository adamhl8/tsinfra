import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { HostEntry } from "#hosts/load.ts"
import { readHomeDirectory } from "#session/paths/home.ts"
import { createShell } from "#session/shell.ts"
import type { Change } from "#session/step-functions/change.ts"
import type { Exec, ChangeTools, CheckTools } from "#session/step-functions/tools.ts"
import { handleExec } from "#session/step-functions/tools.ts"
import type { StepRecord } from "#session/step-recorder.ts"
import { createStepRecorder } from "#session/step-recorder.ts"
import type { StepContext, StepDetails, StepResult } from "#session/step.ts"
import type { EnsureOptions } from "#session/steps/ensure.ts"
import { handleEnsure } from "#session/steps/ensure.ts"
import type { FileOptions } from "#session/steps/file.ts"
import { handleFile } from "#session/steps/file.ts"
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
   * Writes `content` to `path`, and manages the file's mode, owner, and group when they are given. A leading `~/` means
   * the SSH user's home. In `plan` it only checks, and shows a diff of what would change.
   *
   * A path that is a symlink or isn't a regular file fails the host and throws, and so does a failed write.
   */
  file: (path: string, options: FileOptions) => Promise<StepResult<"file">>
  /**
   * Compares what `check` gives to `want`, and in `apply` runs `fix` when they differ, then checks again. In `plan` the
   * fix never runs.
   *
   * A failing fix, or a check that still differs after it, fails the host and throws.
   */
  ensure: <T extends string | boolean>(name: string, options: EnsureOptions<T>) => Promise<StepResult<"ensure">>
  /**
   * Runs `cmd`, a command or a function given `exec`, when a step in `after` changed, or on every pass with `after:
   * "always"`. There is no check, so it never counts as drift. In `plan` it never runs, and reports changed when it
   * would.
   *
   * A failing command fails the host and throws.
   */
  run: (name: string, cmd: Change, options: RunOptions) => Promise<StepResult<"run">>
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
 * Builds the `Host` passed to a host's function, and tracks the run's failure where the script can't see it. It fails
 * when it can't read the SSH user's home directory, which means the host can't run commands at all.
 *
 * This is the only code that throws, because throwing is the contract with the script. Every function the script can
 * call, on `h` or as `read` and `exec`, goes through `callOrFail` around an internal function from `steps/` or
 * `tools.ts` that returns errors as values.
 */
export const createHostSession = async (hostEntry: HostEntry, mode: Mode): Promise<Result<HostSession>> => {
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

  // Read the SSH user's home before the script runs, because a path that starts with `~/` needs it.
  // An unset `$HOME` comes back empty, so this fails only when the host can't run commands at all.
  const home = await readHomeDirectory(shell)
  if (isErr(home)) return err("failed to start the session", err("failed to read the SSH user's home directory", home))

  const callStep = async <K extends StepKind>(
    stepName: string,
    kind: K,
    handler: (ctx: StepContext) => Promise<Result<StepDetails>>,
  ): Promise<StepResult<K>> =>
    callOrFail(async () => {
      const stepRecord = startStep(stepName, kind)
      if (isErr(stepRecord)) return stepRecord

      const stepDetails = await handler({ stepName, mode, shell, home, checkTools, changeTools })

      // Record the failure the host ends up with, because a function in the script may have caught an earlier one.
      const stepFailure = isErr(stepDetails) ? keepFailure(failure, stepDetails) : failure
      finishStep(stepRecord, stepFailure ?? stepDetails)
      if (isErr(stepDetails)) return stepDetails

      const stepResult: StepResult<K> = { name: stepName, kind, changed: stepDetails.changed }
      return stepResult
    })

  const read: Host["read"] = async (cmd) => {
    // Keep the stdout here, because a step reports only its details.
    let stdout = ""
    // Pass `cmd` as the step name, because `h.read` takes no name.
    await callStep(cmd, "read", async () => {
      const output = await handleRead(shell, cmd)
      if (isErr(output)) return output

      stdout = output
      return { status: "observed", changed: false }
    })
    return stdout
  }

  const inspect: Host["inspect"] = async (cmd) => {
    // Keep the result here, because a step reports only its details.
    // Start from an empty result, which is never returned, because `callStep` throws when the inspect fails.
    let commandResult: CommandResult = { stdout: "", stderr: "", exitCode: 0 }
    // Pass `cmd` as the step name, because `h.inspect` takes no name.
    await callStep(cmd, "inspect", async () => {
      const result = await handleInspect(shell, cmd)
      if (isErr(result)) return result

      commandResult = result
      return { status: "observed", changed: false }
    })
    return commandResult
  }

  const file: Host["file"] = async (path, options) =>
    callStep(path, "file", async (ctx) => handleFile(ctx, path, options))

  const ensure: Host["ensure"] = async (stepName, options) =>
    callStep(stepName, "ensure", async (ctx) => handleEnsure(ctx, options))

  const run: Host["run"] = async (stepName, cmd, options) =>
    callStep(stepName, "run", async (ctx) => handleRun(ctx, cmd, options))

  const host: Host = { name, read, inspect, file, ensure, run }

  return { host, stepRecords, getFailure: () => failure }
}
