import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { HostEntry } from "#hosts/load.ts"
import type { Exec } from "#session/exec.ts"
import { runExecCommand } from "#session/exec.ts"
import type { EnsureValueOptions } from "#session/methods/ensure-value.ts"
import { runEnsureValue } from "#session/methods/ensure-value.ts"
import type { EnsureOptions } from "#session/methods/ensure.ts"
import { runEnsure } from "#session/methods/ensure.ts"
import { readOutput } from "#session/methods/read.ts"
import { createShell } from "#session/shell.ts"
import type { StepCall, StepResult } from "#session/step.ts"
import { getTransport } from "#transport/transport.ts"

export interface Host {
  readonly name: string
  /**
   * Runs `cmd` on the host and returns its stdout without trailing newlines. It must not change anything, because it
   * also runs during `plan`.
   *
   * A non-zero exit fails the host and throws. Catching it does not recover the host. Append `|| true` to `cmd` when a
   * non-zero exit is a legitimate answer.
   */
  read: (cmd: string) => Promise<string>
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
}

export interface HostSession {
  host: Host
  getFailure: () => Error | undefined
}

/**
 * Builds the `Host` passed to a host's function, and tracks the run's failure where the script can't see it.
 *
 * The functions it calls return errors as values. Its methods turn them into throws, because that's the contract with
 * the script.
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

  const runOrFail = async <T>(run: () => Promise<Result<T>>) => {
    if (failure) throw failure

    const value = await run()
    if (isErr(value)) fail(value)

    // Throw a failure recorded during `run`, because a function in the script may have caught it and returned normally.
    const recordedFailure = getFailure()
    if (recordedFailure) throw recordedFailure
    return value
  }

  const shell = createShell(getTransport(target))
  const exec: Exec = async (cmd) => runOrFail(async () => runExecCommand(shell, cmd))
  const createStepCall = (stepName: string): StepCall => ({ shell, exec, mode, stepName })

  const host: Host = {
    name,
    read: async (cmd) => runOrFail(async () => readOutput(shell, cmd)),
    ensure: async (stepName, options) => runOrFail(async () => runEnsure(createStepCall(stepName), options)),
    ensureValue: async (stepName, options) => runOrFail(async () => runEnsureValue(createStepCall(stepName), options)),
  }

  return { host, getFailure }
}
