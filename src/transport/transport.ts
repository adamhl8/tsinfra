import type { Result } from "ts-explicit-errors"

import { runLocal } from "#transport/local.ts"
import { closeSshConnection, createSshTransport } from "#transport/ssh.ts"
import { wrapCommand } from "#transport/utils.ts"

export type { RecordingTransport, Shell } from "#transport/shell.ts"
export { createShell } from "#transport/shell.ts"
export {
  createAskpassSudoTransport,
  createPasswordlessSudoTransport,
  createRootTransport,
  WRITE_ASKPASS_HELPER_SCRIPT,
} from "#transport/sudo.ts"

/** The target that runs a host on the control machine itself, without ssh. */
export const LOCAL_TARGET = "@local"

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

/** Wraps each command, because every target runs it in an `sh -s` that reads it from stdin. */
const wrapTransport =
  (transport: Transport): Transport =>
  async (cmd) =>
    transport(wrapCommand(cmd))

/** Returns how to run commands on the control machine, for an `@local` host and for tsinfra's own commands. */
export const getLocalTransport = (): Transport => wrapTransport(runLocal)

/** Returns how to run commands on `target` over ssh, with `sshOptions` added to every call. */
export const getSshTransport = (target: string, sshOptions: string[]): Transport =>
  wrapTransport(createSshTransport(target, sshOptions))

/** Closes the connection to each of `targets` that has one, once per target, at the end of a run. */
export const closeConnections = async (targets: string[]) => {
  const sshTargets = new Set(targets.filter((target) => target !== LOCAL_TARGET))
  const pendingCloses = Array.from(sshTargets, async (target) => closeSshConnection(target))
  await Promise.all(pendingCloses)
}
