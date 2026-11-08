import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { HostSudo } from "#hosts/host.ts"
import { runLocal } from "#transport/local.ts"
import { NO_PASSWORD_SUDO_FUNCTION, buildAskpassSudoFunction } from "#transport/sudo.ts"

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

export type Transport = (script: string) => Promise<Result<CommandOutput>>

/** Returns how to reach `target`. An unsupported target fails at its first command, like an unreachable host. */
const getBaseTransport = (target: string): Transport => {
  if (target === LOCAL_TARGET) return runLocal
  // oxlint-disable-next-line typescript/require-await - a `Transport` returns a promise, and this one has nothing to await
  return async () => err(`target '${target}' isn't supported yet (only '${LOCAL_TARGET}')`, undefined)
}

/**
 * Returns how to run scripts on `target`. Start every script with the `sudo` function that a script's own `sudo` calls,
 * below the recorder, so it's never on the record. With a password in `sudo`, the function gives sudo the password, and
 * without one, sudo fails instead of asking.
 */
export const getTransport = (target: string, sudo: HostSudo): Transport => {
  const baseTransport = getBaseTransport(target)
  const sudoFunction = typeof sudo === "object" ? buildAskpassSudoFunction(sudo.password) : NO_PASSWORD_SUDO_FUNCTION
  return async (script) => baseTransport(`${sudoFunction}\n${script}`)
}
