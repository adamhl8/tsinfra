import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { EnsureOptions } from "#session/handlers/ensure.ts"
import { handleEnsure } from "#session/handlers/ensure.ts"
import type { Want } from "#session/handlers/ensure/check.ts"
import type { FileContent, FileOptions } from "#session/handlers/file.ts"
import { handleFile } from "#session/handlers/file.ts"
import { handleInspect } from "#session/handlers/inspect.ts"
import { handleRead } from "#session/handlers/read.ts"
import type { RunOptions } from "#session/handlers/run.ts"
import { handleRun } from "#session/handlers/run.ts"
import type { ChangeStepResult } from "#session/handlers/shared/change-step-result.ts"
import type { Change } from "#session/handlers/shared/change.ts"
import { createConverge } from "#session/handlers/shared/converge.ts"
import type { ChangeTools, Exec, Inspect, InspectResult, ReadTools } from "#session/handlers/tools.ts"
import { execCommand, inspectCommand } from "#session/handlers/tools.ts"
import { validateInput } from "#session/handlers/validate-input.ts"
import type { HostContext } from "#session/host-context.ts"
import { createShell } from "#session/shell.ts"
import type { StepRecord } from "#session/step-recorder.ts"
import { createStepRecorder } from "#session/step-recorder.ts"
import type { HandlerReturn, StepContext, StepKind, StepOptions } from "#session/step.ts"
import { nonEmptyStringSchema, stepOptionsSchema } from "#session/step.ts"
import { createSudoTransport } from "#transport/sudo.ts"

// Extend `Record<StepKind, unknown>` so a step kind with no method fails to compile.
/** What a host's function is given. Each method call is one step, and steps run one at a time at the top level. */
export interface Host extends Record<StepKind, unknown> {
  readonly name: string
  /**
   * Runs `cmd` on the host and returns its stdout, trimmed. It must not change what the script manages, because it also
   * runs during `plan`.
   *
   * A non-zero exit fails the host and throws. Catching it does not recover the host. Use `inspect` when a non-zero
   * exit is a legitimate answer.
   */
  read: (cmd: string) => Promise<string>
  /**
   * Runs `cmd` on the host and returns its stdout and stderr, both trimmed, and its exit code. It must not change what
   * the script manages, because it also runs during `plan`.
   *
   * A non-zero exit is an answer, not a failure. Only a command that can't run at all fails the host and throws.
   */
  inspect: (cmd: string) => Promise<InspectResult>
  /**
   * Writes `content` to `path`, and manages the file's mode, user, and group when they are given. A leading `~/` means
   * the SSH user's home. In `plan` it only reads the file's state, and shows a diff of what would change.
   *
   * A path that is a symlink or isn't a regular file fails the host and throws. So does content that can't be read,
   * like a missing local file, and a failed write.
   */
  file: (path: string, content: FileContent, options?: FileOptions) => Promise<ChangeStepResult<"file">>
  /**
   * Compares what `check` gives to `want`, and in `apply` runs `fix` when they differ, then checks again. In `plan` the
   * fix never runs.
   *
   * A failing fix, or a check that still differs after it, fails the host and throws.
   */
  ensure: <T extends Want>(name: string, options: EnsureOptions<T>) => Promise<ChangeStepResult<"ensure">>
  /**
   * Runs `cmd`, a command or a function given `exec`, when a step in `after` changed, or on every pass with `after:
   * "always"`. It doesn't read the host's state, so it never counts as drift. In `plan` it never runs, and reports
   * changed when it would.
   *
   * A failing command fails the host and throws.
   */
  run: (name: string, cmd: Change, options: RunOptions) => Promise<ChangeStepResult<"run">>
}

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
 * Builds the `Host` passed to a host's function, and tracks the run's failure where the script can't see it.
 *
 * This is the only code that throws, because throwing is the contract with the script. Every function the script can
 * call, on `h` or as a tool, goes through `callOrFail` around an internal function from `handlers/` that returns errors
 * as values.
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

  const { stepRecords, recordCommands, startStep, finishStep, convergeRecorder } = createStepRecorder()

  // Record each command under the running step, because every command passes through the transport.
  const shell = createShell(recordCommands(transport))
  const sudoShell = createShell(recordCommands(createSudoTransport(transport)))
  // Record what `converge` finds as it goes, so a failure can't lose it and a handler never records anything itself.
  const converge = createConverge(mode, convergeRecorder)

  const callStep = async <K extends StepKind, T>(
    stepName: unknown,
    kind: K,
    handler: (ctx: StepContext<K>) => Promise<Result<HandlerReturn<T>>>,
    options: StepOptions = {},
  ): Promise<T> =>
    callOrFail(async () => {
      // Validate the name before recording the step, because the output shows every recorded step by its name.
      const validName = validateInput(stepName, nonEmptyStringSchema, {
        inputLabel: STEP_NAME_LABELS[kind],
        givenTo: kind,
      })
      if (isErr(validName)) return validName

      const stepRecord = startStep(validName, kind)
      if (isErr(stepRecord)) return stepRecord

      // Validate `options` after recording the step, so a bad one fails under the step like the step's other inputs.
      const validOptions = validateInput(options, stepOptionsSchema, { inputLabel: "options", givenTo: kind })
      if (isErr(validOptions)) {
        finishStep(stepRecord, keepFailure(failure, validOptions))
        return validOptions
      }

      // Leave the tools on the plain shell, because no tool takes a `sudo` option.
      const readTool: Exec = async (cmd) => callOrFail(async () => execCommand({ toolName: "read", shell }, cmd))
      const inspectTool: Inspect = async (cmd) =>
        callOrFail(async () => inspectCommand({ toolName: "inspect", shell }, cmd))
      const execTool: Exec = async (cmd) => callOrFail(async () => execCommand({ toolName: "exec", shell }, cmd))
      const readTools: ReadTools = { read: readTool, inspect: inspectTool }
      const changeTools: ChangeTools = { exec: execTool, inspect: inspectTool }

      const stepShell = validOptions.sudo ? sudoShell : shell

      const ctx: StepContext<K> = {
        stepName: validName,
        kind,
        mode,
        shell: stepShell,
        home,
        readTools,
        changeTools,
        converge,
      }

      const handlerReturn = await handler(ctx)

      // Record the failure the host ends up with, because a function in the script may have caught an earlier one.
      if (isErr(handlerReturn)) {
        finishStep(stepRecord, keepFailure(failure, handlerReturn))
        return handlerReturn
      }

      finishStep(stepRecord, failure ?? handlerReturn.status)
      return handlerReturn.value
    })

  const host: Host = {
    name,
    // Pass `cmd` as the step name, because `h.read` and `h.inspect` take no name.
    read: async (cmd) => callStep(cmd, "read", async (ctx) => handleRead(ctx, cmd)),
    inspect: async (cmd) => callStep(cmd, "inspect", async (ctx) => handleInspect(ctx, cmd)),
    file: async (path, content, options) =>
      callStep(path, "file", async (ctx) => handleFile(ctx, path, content, options), options),
    ensure: async (stepName, options) => callStep(stepName, "ensure", async (ctx) => handleEnsure(ctx, options)),
    run: async (stepName, cmd, options) => callStep(stepName, "run", async (ctx) => handleRun(ctx, cmd, options)),
  }

  return { host, stepRecords, getFailure: () => failure }
}
