import type { Result } from "ts-explicit-errors"

import { runLocal } from "#transport/local.ts"
import { closeSshConnection, createSshTransport } from "#transport/ssh.ts"
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

/** Returns how to reach `target`: `@local` is the control machine, and any other target goes through ssh. */
const getTargetTransport = (target: string): Transport =>
  target === LOCAL_TARGET ? runLocal : createSshTransport(target)

/**
 * Returns how to run commands on `target`. Wrap each command here, because every target runs it in an `sh -s` that
 * reads it from stdin.
 */
export const getTransport = (target: string): Transport => {
  const targetTransport = getTargetTransport(target)
  return async (cmd) => targetTransport(wrapCommand(cmd))
}

/** Closes the connection to each of `targets` that has one, once per target, at the end of a run. */
export const closeConnections = async (targets: string[]) => {
  const sshTargets = new Set(targets.filter((target) => target !== LOCAL_TARGET))
  const pendingCloses = Array.from(sshTargets, async (target) => closeSshConnection(target))
  await Promise.all(pendingCloses)
}
