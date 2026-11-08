import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import { runLocal } from "#transport/local.ts"
import { wrapCommand } from "#transport/wrap-command.ts"

const LOCAL_TARGET = "@local"

/**
 * What a command produced on the host, exactly as it printed it. Only failing to run at all is an error, so a non-zero
 * exit is still output.
 */
export interface CommandOutput {
  stdout: string
  stderr: string
  exitCode: number
}

export type Transport = (cmd: string) => Promise<Result<CommandOutput>>

/** Returns how to reach `target`. An unsupported target fails at its first command, like an unreachable host. */
const getTargetTransport = (target: string): Transport => {
  if (target === LOCAL_TARGET) return runLocal
  // oxlint-disable-next-line typescript/require-await - a `Transport` returns a promise, and this one has nothing to await
  return async () => err(`target '${target}' isn't supported yet (only '${LOCAL_TARGET}')`, undefined)
}

/**
 * Returns how to run commands on `target`. Wrap each command here, because every target runs it in an `sh -s` that
 * reads it from stdin.
 */
export const getTransport = (target: string): Transport => {
  const targetTransport = getTargetTransport(target)
  return async (cmd) => targetTransport(wrapCommand(cmd))
}
