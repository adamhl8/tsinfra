import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { EnsureOptions } from "#session/handlers/ensure.ts"
import { handleEnsure } from "#session/handlers/ensure.ts"
import type { FileOptions } from "#session/handlers/file.ts"
import { handleFile } from "#session/handlers/file.ts"
import { handleInspect } from "#session/handlers/inspect.ts"
import { handleRead } from "#session/handlers/read.ts"
import type { RunOptions } from "#session/handlers/run.ts"
import { handleRun } from "#session/handlers/run.ts"
import type { Change } from "#session/handlers/shared/change.ts"
import { validateStepName } from "#session/handlers/step-name.ts"
import type { ChangeTools, CheckTools, CommandResult, Exec, Inspect } from "#session/handlers/tools.ts"
import { execCommand, inspectCommand } from "#session/handlers/tools.ts"
import type { HostContext } from "#session/host-context.ts"
import { createShell } from "#session/shell.ts"
import type { StepRecord } from "#session/step-recorder.ts"
import { createStepRecorder } from "#session/step-recorder.ts"
import type { StepContext, StepOutcome, StepResult } from "#session/step.ts"

/** What a host's function is given. Each method call is one step, and steps run one at a time at the top level. */
export interface Host {
  readonly name: string
  /**
   * Runs `cmd` on the host and returns its stdout, trimmed. It must not change what the script manages, because it also
   * runs during `plan`.
   *
   * A non-zero exit fails the host and throws. Catching it does not recover the host. Use `inspect` when a non-zero
   * exit is a legitimate answer.
   */
  read: Exec
  /**
   * Runs `cmd` on the host and returns its stdout and stderr, both trimmed, and its exit code. It must not change what
   * the script manages, because it also runs during `plan`.
   *
   * A non-zero exit is an answer, not a failure. Only a command that can't run at all fails the host and throws.
   */
  inspect: Inspect
  /**
   * Writes `content` to `path`, and manages the file's mode, owner, and group when they are given. A leading `~/` means
   * the SSH user's home. In `plan` it only reads the file's state, and shows a diff of what would change.
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
   * "always"`. It doesn't read the host's state, so it never counts as drift. In `plan` it never runs, and reports
   * changed when it would.
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
 * Builds the `Host` passed to a host's function, and tracks the run's failure where the script can't see it.
 *
 * This is the only code that throws, because throwing is the contract with the script. Every function the script can
 * call, on `h` or as `read` and `exec`, goes through `callOrFail` around an internal function from `handlers/` that
 * returns errors as values.
 */
export const createHostSession = (hostContext: HostContext, mode: Mode): HostSession => {
  const { name, transport, home } = hostContext
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
    // Widen `failure` with `as`, because TypeScript keeps the narrowing to `undefined` from the `if` above.
    // TypeScript can't know that `callback` may have set `failure` again.
    const callbackFailure = failure as Failure
    if (callbackFailure) throw callbackFailure
    return value
  }

  const { stepRecords, recordCommands, startStep, finishStep } = createStepRecorder()

  // Record each command under the running step, because every command passes through the transport.
  const shell = createShell(recordCommands(transport))

  const callStep = async <K extends StepKind>(
    stepName: unknown,
    kind: K,
    handler: (ctx: StepContext) => Promise<Result<StepOutcome>>,
  ): Promise<StepResult<K>> =>
    callOrFail(async () => {
      // Validate the name before recording the step, because the output shows every recorded step by its name.
      const validName = validateStepName(stepName, kind)
      if (isErr(validName)) return validName

      const stepRecord = startStep(validName, kind)
      if (isErr(stepRecord)) return stepRecord

      const readTool: Exec = async (cmd) => callOrFail(async () => execCommand({ toolName: "read", shell }, cmd))
      const inspectTool: Inspect = async (cmd) =>
        callOrFail(async () => inspectCommand({ toolName: "inspect", shell }, cmd))
      const execTool: Exec = async (cmd) => callOrFail(async () => execCommand({ toolName: "exec", shell }, cmd))
      const checkTools: CheckTools = { read: readTool, inspect: inspectTool }
      const changeTools: ChangeTools = { exec: execTool, inspect: inspectTool }
      const ctx: StepContext = { stepName: validName, mode, shell, home, checkTools, changeTools }

      const outcome = await handler(ctx)

      // Record the failure the host ends up with, because a function in the script may have caught an earlier one.
      const stepFailure = isErr(outcome) ? keepFailure(failure, outcome) : failure
      finishStep(stepRecord, stepFailure ?? outcome)
      if (isErr(outcome)) return outcome

      const stepResult: StepResult<K> = { name: validName, kind, changed: outcome.changed }
      return stepResult
    })

  const read: Host["read"] = async (cmd) => {
    // Keep the stdout here, because a step reports only its outcome.
    let stdout = ""
    // Pass `cmd` as the step name, because `h.read` takes no name.
    await callStep(cmd, "read", async (ctx) => {
      const output = await handleRead(ctx, cmd)
      if (isErr(output)) return output

      stdout = output
      return { status: "observed", changed: false }
    })
    return stdout
  }

  const inspect: Host["inspect"] = async (cmd) => {
    // Keep the result here, because a step reports only its outcome.
    // Start from an empty result, which is never returned, because `callStep` throws when the inspect fails.
    let commandResult: CommandResult = { stdout: "", stderr: "", exitCode: 0 }
    // Pass `cmd` as the step name, because `h.inspect` takes no name.
    await callStep(cmd, "inspect", async (ctx) => {
      const result = await handleInspect(ctx, cmd)
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
