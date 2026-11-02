import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import { runLocal } from "#transport/local.ts"

const LOCAL_TARGET = "@local"

/**
 * What a command produced on the target, exactly as it printed it. Only failing to run at all is an error, so a
 * non-zero exit is still output.
 */
export interface CommandOutput {
  stdout: string
  stderr: string
  exitCode: number
}

export type Transport = (script: string) => Promise<Result<CommandOutput>>

/** Returns how to run scripts on `target`. An unsupported target fails at its first command, like an unreachable host. */
export const getTransport = (target: string): Transport => {
  if (target === LOCAL_TARGET) return runLocal
  // oxlint-disable-next-line typescript/require-await - a `Transport` returns a promise, and this one has nothing to await
  return async () => err(`target '${target}' isn't supported yet (only '${LOCAL_TARGET}')`, undefined)
}
