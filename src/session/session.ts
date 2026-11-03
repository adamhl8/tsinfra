import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { LoadedHost } from "#hosts/load.ts"
import type { Shell } from "#session/shell.ts"
import { createShell } from "#session/shell.ts"
import type { Change } from "#session/step-functions/change.ts"
import type { Exec, ChangeTools, CheckTools } from "#session/step-functions/tools.ts"
import { handleExec } from "#session/step-functions/tools.ts"
import type { StepRecord } from "#session/step-recorder.ts"
import { createStepRecorder } from "#session/step-recorder.ts"
import type { StepContext, StepOutcome, StepResult } from "#session/step.ts"
import { nonEmptyStringSchema } from "#session/step.ts"
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
   * Runs `cmd` on the host and returns its stdout, trimmed. It must not change what the script manages, because it also
   * runs during `plan`.
   *
   * A non-zero exit fails the host and throws. Catching it does not recover the host. Use `inspect` when a non-zero
   * exit is a legitimate answer.
   */
  read: Read
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

// Read `$HOME` with `printf '%s'`, because it prints the value exactly, with no newline to strip.
// `echo` treats backslashes or a leading `-n` specially in some shells.
const READ_HOME_COMMAND = `printf '%s' "$HOME"`

/** Reads the SSH user's home directory, which comes back empty when `$HOME` isn't set. */
const readHomeDirectory = async (shell: Shell): Promise<Result<string>> => shell.run(READ_HOME_COMMAND)

// Name what each step takes as its name, so a validation error says which argument is wrong.
const STEP_NAME_LABELS: Record<StepKind, string> = {
  read: "command",
  inspect: "command",
  file: "path",
  ensure: "name",
  run: "name",
}

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
export const createHostSession = async (loadedHost: LoadedHost, mode: Mode): Promise<Result<HostSession>> => {
  const { name, target } = loadedHost
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
    handler: (ctx: StepContext) => Promise<Result<StepOutcome>>,
  ): Promise<StepResult<K>> =>
    callOrFail(async () => {
      // Validate the name before recording the step, because the output shows every recorded step by its name.
      const validName = nonEmptyStringSchema(stepName)
      if (validName instanceof type.errors) {
        return err(
          `failed to validate the ${STEP_NAME_LABELS[kind]} given to '${kind}'`,
          err(validName.summary, undefined),
        )
      }

      const stepRecord = startStep(stepName, kind)
      if (isErr(stepRecord)) return stepRecord

      const outcome = await handler({ stepName, mode, shell, home, checkTools, changeTools })

      // Record the failure the host ends up with, because a function in the script may have caught an earlier one.
      const stepFailure = isErr(outcome) ? keepFailure(failure, outcome) : failure
      finishStep(stepRecord, stepFailure ?? outcome)
      if (isErr(outcome)) return outcome

      const stepResult: StepResult<K> = { name: stepName, kind, changed: outcome.changed }
      return stepResult
    })

  const read: Host["read"] = async (cmd) => {
    // Keep the stdout here, because a step reports only its outcome.
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
    // Keep the result here, because a step reports only its outcome.
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
