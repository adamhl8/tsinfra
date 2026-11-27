import type { HostOptions } from "#core/hosts/host.ts"
import type { HostFacts } from "#core/hosts/prepare/host-details/facts.ts"
import type { HostMeta } from "#core/hosts/prepare/host-meta.ts"
import { createCallStep } from "#core/session/call-step.ts"
import type { SessionSetup } from "#core/session/context.ts"
import type { DirOptions } from "#core/session/handlers/dir.ts"
import { handleDir } from "#core/session/handlers/dir.ts"
import type { EnsureOptions } from "#core/session/handlers/ensure.ts"
import { handleEnsure } from "#core/session/handlers/ensure.ts"
import type { SetWant } from "#core/session/handlers/ensure/comparison/set.ts"
import type { WantOf } from "#core/session/handlers/ensure/want.ts"
import type { FileContent, FileOptions } from "#core/session/handlers/file.ts"
import { handleFile } from "#core/session/handlers/file.ts"
import type { InspectOptions } from "#core/session/handlers/inspect.ts"
import { handleInspect } from "#core/session/handlers/inspect.ts"
import type { LinkOptions } from "#core/session/handlers/link.ts"
import { handleLink } from "#core/session/handlers/link.ts"
import type { Log } from "#core/session/handlers/log.ts"
import type { ReadOptions } from "#core/session/handlers/read.ts"
import { handleRead } from "#core/session/handlers/read.ts"
import type { RunOptions } from "#core/session/handlers/run.ts"
import { handleRun } from "#core/session/handlers/run.ts"
import type { ChangeStepResult } from "#core/session/handlers/shared/change-step-result.ts"
import type { Change } from "#core/session/handlers/shared/change.ts"
import type { InspectResult } from "#core/session/handlers/tools.ts"
import { createLog } from "#core/session/log.ts"
import { createScriptBoundary } from "#core/session/script-boundary.ts"
import type { StepKind } from "#core/session/step.ts"
import type { Mode } from "#mode.ts"

// Extend `Record<StepKind, unknown>` so a step kind with no method fails to compile.
/**
 * What a host's function is given. Each call to a step's method is one step, and steps run one at a time at the top
 * level.
 */
export interface Host<O extends HostOptions = HostOptions> extends Record<StepKind, unknown> {
  /** What the script is given about the host besides its steps, like its name. `O` is the type of its options. */
  readonly meta: HostMeta<O>
  /** What tsinfra read from the host before the script ran, which nothing in a run would change, like its CPU. */
  readonly facts: HostFacts
  /**
   * Records a message for the report, which shows it under the step whose function logged it, or between the steps
   * around it. A message that isn't a non-empty string fails the host and throws.
   */
  readonly log: Log
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
   * Makes `path` a symlink to `target`, on the same host, and manages its user and group when they are given, and the
   * target's mode and owner with `targetAttributes`. Both must be absolute, and a leading `~/` means the SSH user's
   * home. In `plan` it only reads what's at the path and the target.
   *
   * A regular file or an empty directory at the path fails the host and throws, unless `force` is set. So does a
   * directory with files in it, always, and a failed write. So does a target attribute an earlier step set
   * differently.
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
    <T extends WantOf<T>>(name: string, options: EnsureOptions<T>): Promise<ChangeStepResult<"ensure">>
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

/**
 * Builds the `Host` passed to a host's function, and keeps the run's failure on the host's record through
 * `sessionRecorder`, where the script can't see it. Every method goes through the script boundary, which is the only
 * code that throws.
 */
export const createHostSession = (sessionSetup: SessionSetup, mode: Mode): Host => {
  const { meta, facts, sessionRecorder } = sessionSetup
  const scriptBoundary = createScriptBoundary(sessionRecorder)
  const log = createLog(sessionRecorder, scriptBoundary)
  const callStep = createCallStep(sessionSetup, mode, scriptBoundary)

  const host: Host = {
    meta,
    facts,
    log,
    // Pass `cmd` as the step name, because `h.read` and `h.inspect` take no name.
    read: async (cmd, options) => callStep(cmd, "read", async (ctx) => handleRead(ctx, cmd, options), options),
    inspect: async (cmd, options) => callStep(cmd, "inspect", async (ctx) => handleInspect(ctx, cmd, options), options),
    file: async (path, content, options) =>
      callStep(path, "file", async (ctx) => handleFile(ctx, path, content, options), options),
    link: async (path, target, options) =>
      callStep(path, "link", async (ctx) => handleLink(ctx, path, target, options), options),
    dir: async (path, options) => callStep(path, "dir", async (ctx) => handleDir(ctx, path, options), options),
    ensure: async <T extends WantOf<T>>(stepName: string, options: EnsureOptions<T>) =>
      callStep(stepName, "ensure", async (ctx) => handleEnsure(ctx, options), options),
    run: async (stepName, cmd, options) =>
      callStep(stepName, "run", async (ctx) => handleRun(ctx, cmd, options), options),
  }

  return host
}
