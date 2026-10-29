import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { ShellOutput } from "#transport/local.ts"
import { runLocal } from "#transport/local.ts"

const LOCAL_TARGET = "@local"

type Transport = (script: string) => Promise<Result<ShellOutput>>

/** Returns how to run scripts on `target`. An unsupported target fails at its first command, like an unreachable host. */
export const getTransport = (target: string): Transport => {
  if (target === LOCAL_TARGET) return runLocal
  // oxlint-disable-next-line typescript/require-await - a `Transport` returns a promise, and this one has nothing to await
  return async () => err(`target '${target}' isn't supported yet (only '${LOCAL_TARGET}')`, undefined)
}
