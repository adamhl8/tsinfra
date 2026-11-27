// oxlint-disable promise/prefer-await-to-callbacks - the rule matches the name `callback`, and every `callback` here is awaited or synchronous
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { FailureRecorder } from "#core/recorder/session-recorder.ts"

/** Runs `callback`, and returns its value, or records its error as the host's failure and throws it. */
export type CallOrFail = <T>(callback: () => Promise<Result<T>>) => Promise<T>

/** The functions that turn what the script calls into a value or a throw. */
export interface ScriptBoundary {
  callOrFail: CallOrFail
  /** Does what `callOrFail` does, for a method the script calls without awaiting, like `h.log`'s. */
  callOrFailSync: <T>(callback: () => Result<T>) => T
}

/**
 * Returns the boundary between the script and the internals, which return errors as values. This is the only code in
 * `core/` that throws, because throwing is the contract with the script. Every function the script can call, on `h` or
 * as a tool, goes through it.
 */
export const createScriptBoundary = (failureRecorder: FailureRecorder): ScriptBoundary => {
  const { getFailure, recordFailure } = failureRecorder

  // Throw the failure on every later call, so a script that catches it still can't use the host.
  const throwIfFailed = () => {
    const failure = getFailure()
    if (failure) throw failure
  }

  /**
   * Returns `value`, or records its error as the host's failure and throws it. Throws a failure recorded while the
   * callback ran too, because a function in the script may have caught it and returned normally.
   */
  const toValueOrThrow = <T>(value: Result<T>): T => {
    if (isErr(value)) throw recordFailure(value, "host fn")

    const callbackFailure = getFailure()
    if (callbackFailure) throw callbackFailure
    return value
  }

  const callOrFail: CallOrFail = async (callback) => {
    throwIfFailed()
    const value = await callback()
    return toValueOrThrow(value)
  }

  const callOrFailSync = <T>(callback: () => Result<T>): T => {
    throwIfFailed()
    const value = callback()
    return toValueOrThrow(value)
  }

  return { callOrFail, callOrFailSync }
}
