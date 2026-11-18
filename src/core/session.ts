import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HostOptions } from "#core/hosts/host.ts"
import type { HomeDirectory } from "#core/hosts/prepare/host-details.ts"
import type { DirOptions } from "#core/session/handlers/dir.ts"
import { handleDir } from "#core/session/handlers/dir.ts"
import type { EnsureOptions } from "#core/session/handlers/ensure.ts"
import { handleEnsure } from "#core/session/handlers/ensure.ts"
import type { SetWant } from "#core/session/handlers/ensure/comparison/set.ts"
import type { Want } from "#core/session/handlers/ensure/want.ts"
import type { FileContent, FileOptions } from "#core/session/handlers/file.ts"
import { handleFile } from "#core/session/handlers/file.ts"
import type { InspectOptions } from "#core/session/handlers/inspect.ts"
import { handleInspect } from "#core/session/handlers/inspect.ts"
import type { LinkOptions } from "#core/session/handlers/link.ts"
import { handleLink } from "#core/session/handlers/link.ts"
import type { StepShellOptions } from "#core/session/handlers/options/shell.ts"
import { stepShellOptionsSchema } from "#core/session/handlers/options/shell.ts"
import type { ReadOptions } from "#core/session/handlers/read.ts"
import { handleRead } from "#core/session/handlers/read.ts"
import type { RunOptions } from "#core/session/handlers/run.ts"
import { handleRun } from "#core/session/handlers/run.ts"
import type { ChangeStepResult } from "#core/session/handlers/shared/change-step-result.ts"
import type { Change } from "#core/session/handlers/shared/change.ts"
import { validateInput } from "#core/session/handlers/shared/validate-input.ts"
import type { ChangeTools, Exec, Inspect, InspectResult, ReadTools } from "#core/session/handlers/tools.ts"
import { execCommand, inspectCommand } from "#core/session/handlers/tools.ts"
import type { HostMeta } from "#core/session/host-meta.ts"
import type { SessionRecorder } from "#core/session/recorder/session-recorder.ts"
import type { SavedStateManager } from "#core/session/saved-state.ts"
import type { ChangeStepKind, HandlerReturn, StepContext, StepKind } from "#core/session/step.ts"
import { isChangeStepKind, nonEmptyStringSchema } from "#core/session/step.ts"
import type { Shell } from "#core/transport/shell.ts"
import type { Mode } from "#mode.ts"

/** What a host's session needs, set up before any script runs. */
export interface SessionContext {
  meta: HostMeta
  /** The SSH user's home directory. */
  home: HomeDirectory
  /** The host's saved state, read when it was prepared. */
  savedStateManager: SavedStateManager
  sessionRecorder: SessionRecorder
}

// Extend `Record<StepKind, unknown>` so a step kind with no method fails to compile.
/** What a host's function is given. Each method call is one step, and steps run one at a time at the top level. */
export interface Host<O extends HostOptions = HostOptions> extends Record<StepKind, unknown> {
  /** What the script is given about the host besides its steps, like its name. `O` is the type of its options. */
  readonly meta: HostMeta<O>
  /**
   * Runs `cmd` on the host and returns its stdout, trimmed. It must not change what the script manages, because it also
   * runs during `plan`.
   *
   * A non-zero exit fails the host and throws. Catching it does not recover the host. Use `inspect` when a non-zero
   * exit is a legitimate answer.
   */
  read: (cmd: string, options?: ReadOptions) => Promise<string>
  /**
   * Runs `cmd` on the host and returns its stdout and stderr, both trimmed, and its exit code. It must not change what
   * the script manages, because it also runs during `plan`.
   *
   * A non-zero exit is an answer, not a failure. Only a command that can't run at all fails the host and throws.
   */
  inspect: (cmd: string, options?: InspectOptions) => Promise<InspectResult>
  /**
   * Writes `content` to `path`, and manages the file's mode, user, and group when they are given. A leading `~/` means
   * the SSH user's home. In `plan` it only reads the file's state, and shows a diff of what would change.
   *
   * A path that is a symlink or isn't a regular file fails the host and throws. So does content that can't be read,
   * like a missing local file, and a failed write.
   */
  file: (path: string, content: FileContent, options?: FileOptions) => Promise<ChangeStepResult<"file">>
  /**
   * Makes `path` a symlink to `target`, on the same host, and manages its user and group when they are given. Both must
   * be absolute, and a leading `~/` means the SSH user's home. In `plan` it only reads what's at the path.
   *
   * A regular file or an empty directory at the path fails the host and throws, unless `force` is set. So does a
   * directory with files in it, always, and a failed write.
   */
  link: (path: string, target: string, options?: LinkOptions) => Promise<ChangeStepResult<"link">>
  /**
   * Makes sure `path` is a directory, and makes it and any parents it's missing when it isn't. Manages its mode, user,
   * and group when they are given, but not its parents', which get the default mode and owner. It must be absolute, and
   * a leading `~/` means the SSH user's home. In `plan` it only reads what's at the path.
   *
   * A symlink, a regular file, or anything else at the path fails the host and throws. So does a failed write.
   */
  dir: (path: string, options?: DirOptions) => Promise<ChangeStepResult<"dir">>
  /**
   * Compares what `check` gives to `want`, and in `apply` runs `fix` when they differ, then checks again. In `plan` the
   * fix never runs.
   *
   * A failing fix, or a check that still differs after it, fails the host and throws.
   */
  ensure: {
    // Try a set `want` first, so an empty `new Set()` is a set of strings, not of `unknown`.
    (name: string, options: EnsureOptions<SetWant>): Promise<ChangeStepResult<"ensure">>
    <T extends Want>(name: string, options: EnsureOptions<T>): Promise<ChangeStepResult<"ensure">>
  }
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
  link: "path",
  dir: "path",
  ensure: "name",
  run: "name",
}

/**
 * Builds the `Host` passed to a host's function, and keeps the run's failure on the host's record through
 * `sessionRecorder`, where the script can't see it.
 *
 * This is the only code that throws, because throwing is the contract with the script. Every function the script can
 * call, on `h` or as a tool, goes through `callOrFail` around an internal function from `handlers/` that returns errors
 * as values.
 */
export const createHostSession = (sessionContext: SessionContext, mode: Mode): Host => {
  const { meta, home, savedStateManager, sessionRecorder } = sessionContext
  const { getStepShells, recordOptions, getFailure, recordFailure, startStep, finishStep, failStep, convergeRecorder } =
    sessionRecorder

  // oxlint-disable-next-line promise/prefer-await-to-callbacks - `callback` is awaited, and the rule only matches its name
  const callOrFail = async <T>(callback: () => Promise<Result<T>>) => {
    // Throw the failure on every later call, so a script that catches it still can't use the host.
    const failure = getFailure()
    if (failure) throw failure

    // oxlint-disable-next-line promise/prefer-await-to-callbacks - `callback` is awaited, and the rule only matches its name
    const value = await callback()
    if (isErr(value)) throw recordFailure(value, "host fn")

    // Throw a failure recorded during `callback`, because a function in the script may have caught it and returned normally.
    const callbackFailure = getFailure()
    if (callbackFailure) throw callbackFailure
    return value
  }

  /** Returns the tools a step's functions are given, running their commands on the step's `toolShell`. */
  const createTools = (toolShell: Shell) => {
    const readTool: Exec = async (cmd, options) =>
      callOrFail(async () => execCommand({ toolName: "read", shell: toolShell }, cmd, options))
    const inspectTool: Inspect = async (cmd, options) =>
      callOrFail(async () => inspectCommand({ toolName: "inspect", shell: toolShell }, cmd, options))
    const execTool: Exec = async (cmd, options) =>
      callOrFail(async () => execCommand({ toolName: "exec", shell: toolShell }, cmd, options))
    const readTools: ReadTools = { read: readTool, inspect: inspectTool }
    const changeTools: ChangeTools = { exec: execTool, inspect: inspectTool }
    return { readTools, changeTools }
  }

  const stepKindsByName = new Map<string, ChangeStepKind>()
  // Refuse a name an earlier change step has, because the report and `needs` tell steps apart by name.
  const claimStepName = (stepName: string, kind: StepKind): Result => {
    if (!isChangeStepKind(kind)) return

    const earlierKind = stepKindsByName.get(stepName)
    if (earlierKind) {
      return err(
        `an earlier ${earlierKind} step has the same name, and step names must be unique in a host script`,
        undefined,
      )
    }

    stepKindsByName.set(stepName, kind)
  }

  // Share these sets across the session's steps, because a step checks whether the steps it follows or needs changed.
  // A run also checks whether the steps it follows run on every pass.
  const changedStepNames = new Set<string>()
  const ranAlwaysStepNames = new Set<string>()

  const callStep = async <K extends StepKind, T>(
    stepName: unknown,
    kind: K,
    handler: (ctx: StepContext<K>) => Promise<Result<HandlerReturn<T>>>,
    options: StepShellOptions = {},
  ): Promise<T> =>
    callOrFail(async () => {
      // Validate the name before recording the step, because the output shows every recorded step by its name.
      const validName = validateInput(stepName, nonEmptyStringSchema, {
        inputLabel: STEP_NAME_LABELS[kind],
        givenTo: kind,
      })
      if (isErr(validName)) return validName

      const stepStart = startStep(validName, kind)
      if (isErr(stepStart)) return stepStart

      const nameClaim = claimStepName(validName, kind)
      if (isErr(nameClaim)) {
        failStep(nameClaim)
        return nameClaim
      }

      // Validate `options` after recording the step, so a bad one fails under the step like the step's other inputs.
      const validOptions = validateInput(options, stepShellOptionsSchema, { inputLabel: "options", givenTo: kind })
      if (isErr(validOptions)) {
        failStep(validOptions)
        return validOptions
      }

      const { stepShell, toolShell } = getStepShells(validOptions)
      const { readTools, changeTools } = createTools(toolShell)

      const ctx: StepContext<K> = {
        stepName: validName,
        kind,
        mode,
        shell: stepShell,
        home,
        savedStateManager,
        changedStepNames,
        ranAlwaysStepNames,
        readTools,
        changeTools,
        convergeRecorder,
        recordOptions,
      }

      const handlerReturn = await handler(ctx)
      if (isErr(handlerReturn)) {
        failStep(handlerReturn)
        return handlerReturn
      }

      finishStep(handlerReturn.status)
      return handlerReturn.value
    })

  const host: Host = {
    meta,
    // Pass `cmd` as the step name, because `h.read` and `h.inspect` take no name.
    read: async (cmd, options) => callStep(cmd, "read", async (ctx) => handleRead(ctx, cmd, options), options),
    inspect: async (cmd, options) => callStep(cmd, "inspect", async (ctx) => handleInspect(ctx, cmd, options), options),
    file: async (path, content, options) =>
      callStep(path, "file", async (ctx) => handleFile(ctx, path, content, options), options),
    link: async (path, target, options) =>
      callStep(path, "link", async (ctx) => handleLink(ctx, path, target, options), options),
    dir: async (path, options) => callStep(path, "dir", async (ctx) => handleDir(ctx, path, options), options),
    ensure: async <T extends Want>(stepName: string, options: EnsureOptions<T>) =>
      callStep(stepName, "ensure", async (ctx) => handleEnsure(ctx, options), options),
    run: async (stepName, cmd, options) =>
      callStep(stepName, "run", async (ctx) => handleRun(ctx, cmd, options), options),
  }

  return host
}
