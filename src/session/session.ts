import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { HostEntry } from "#hosts/load.ts"
import type { EnsureValueOptions } from "#session/methods/ensure-value.ts"
import { handleEnsureValue } from "#session/methods/ensure-value.ts"
import type { EnsureOptions } from "#session/methods/ensure.ts"
import { handleEnsure } from "#session/methods/ensure.ts"
import type { Exec } from "#session/methods/exec.ts"
import { handleExec } from "#session/methods/exec.ts"
import type { Read } from "#session/methods/read.ts"
import { handleRead } from "#session/methods/read.ts"
import type { RunOptions } from "#session/methods/run.ts"
import { handleRun } from "#session/methods/run.ts"
import { createShell } from "#session/shell.ts"
import type { Action, StepCall, StepResult } from "#session/step.ts"
import { getTransport } from "#transport/transport.ts"

/** What a host's function is given. Each method call is one step, and steps run one at a time at the top level. */
export interface Host {
  readonly name: string
  /**
   * Runs `cmd` on the host and returns its stdout without trailing newlines. It must not change anything, because it
   * also runs during `plan`.
   *
   * A non-zero exit fails the host and throws. Catching it does not recover the host. Append `|| true` to `cmd` when a
   * non-zero exit is a legitimate answer.
   */
  read: Read
  /**
   * Runs `check`, and in `apply` runs `fix` when it fails, then runs `check` again. In `plan` the fix never runs.
   *
   * A failing fix, or a check that still fails after it, fails the host and throws.
   */
  ensure: (name: string, options: EnsureOptions) => Promise<StepResult>
  /**
   * Compares `read` to `want`, and in `apply` runs `fix` when they differ, then compares again. In `plan` the fix never
   * runs.
   *
   * A failing fix, or a value that still differs after it, fails the host and throws.
   */
  ensureValue: (name: string, options: EnsureValueOptions) => Promise<StepResult>
  /**
   * Runs `cmd`, a command or a function given `exec`, when `when` is true. There is no check, so it never counts as
   * drift. In `plan` it never runs, and reports changed when `when` is true.
   *
   * A failing command fails the host and throws.
   */
  run: (name: string, cmd: Action, options: RunOptions) => Promise<StepResult>
}

type StepKind = Exclude<keyof Host, "name">

export interface HostSession {
  host: Host
  getFailure: () => Error | undefined
}

/**
 * Builds the `Host` passed to a host's function, and tracks the run's failure where the script can't see it.
 *
 * This is the only code that throws, because throwing is the contract with the script. Every function the script can
 * call, on `h` or as `read` and `exec`, goes through `callOrFail` around an internal function from `methods/` that
 * returns errors as values.
 */
export const createHostSession = (hostEntry: HostEntry, mode: Mode): HostSession => {
  const { name, target } = hostEntry
  let failure: Error | undefined
  // Read `failure` through `getFailure` after an `await`, because TypeScript keeps the narrowing from an earlier check.
  const getFailure = () => failure

  // Keep the first failure, because calls made at once with `Promise.all` can each fail.
  // Replace it only with an error that wraps it, which adds context such as the step's name.
  // Throw it on every later call, so a script that catches it still can't use the host.
  // Type `fail` itself, not just its return, so TypeScript knows nothing runs after a call to it.
  const fail: (error: Error) => never = (error) => {
    if (failure === undefined || error.cause === failure) failure = error
    throw failure
  }

  // oxlint-disable-next-line promise/prefer-await-to-callbacks - `callback` is awaited, and the rule only matches its name
  const callOrFail = async <T>(callback: () => Promise<Result<T>>) => {
    if (failure) throw failure

    // oxlint-disable-next-line promise/prefer-await-to-callbacks - `callback` is awaited, and the rule only matches its name
    const value = await callback()
    if (isErr(value)) fail(value)

    // Throw a failure recorded during `callback`, because a function in the script may have caught it and returned normally.
    const recordedFailure = getFailure()
    if (recordedFailure) throw recordedFailure
    return value
  }

  // Describes the running step, like "step 'A'" or "read 'uname -m'", for the error a call on `h` gets while it runs.
  let currentStep: string | undefined

  const shell = createShell(getTransport(target))
  const read: Read = async (cmd) => callOrFail(async () => handleRead(shell, cmd))
  const exec: Exec = async (cmd) => callOrFail(async () => handleExec(shell, cmd))

  // Fail a step that starts while another is running, because a step's functions use the tools they are given.
  // This also catches steps run at once with `Promise.all`.
  const callStep = async <T>(kind: StepKind, stepName: string, handler: (stepCall: StepCall) => Promise<Result<T>>) =>
    callOrFail(async () => {
      if (currentStep !== undefined) return err(`'${kind}' can't run while ${currentStep} is running`, undefined)

      // Name a read by its command, because `h.read` takes no name.
      currentStep = kind === "read" ? `read '${stepName}'` : `step '${stepName}'`
      const value = await handler({ shell, read, exec, mode, stepName })
      currentStep = undefined
      return value
    })

  const host: Host = {
    name,
    read: async (cmd) => callStep("read", cmd, async () => handleRead(shell, cmd)),
    ensure: async (stepName, options) =>
      callStep("ensure", stepName, async (stepCall) => handleEnsure(stepCall, options)),
    ensureValue: async (stepName, options) =>
      callStep("ensureValue", stepName, async (stepCall) => handleEnsureValue(stepCall, options)),
    run: async (stepName, cmd, options) =>
      callStep("run", stepName, async (stepCall) => handleRun(stepCall, cmd, options)),
  }

  return { host, getFailure }
}
