import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { LoadedHost } from "#hosts/load.ts"
import { promptForSudoPassword, resolveHostSudo } from "#hosts/prepare/host-details/host-sudo/host-sudo.ts"
import { readSshDefaultOptions } from "#hosts/prepare/host-details/ssh-options.ts"
import type { PreparationRecorder } from "#session/session.ts"
import {
  WRITE_ASKPASS_HELPER_SCRIPT,
  createAskpassSudoTransport,
  createPasswordlessSudoTransport,
  LOCAL_TARGET,
  getLocalTransport,
  getSshTransport,
} from "#transport/transport.ts"
import type { Shell, Transport } from "#transport/transport.ts"

/** What preparation reads from a host before its transport is built. */
export interface HostDetails {
  /** The SSH user's home directory. It's empty when `$HOME` isn't set. */
  home: string
  /** The SSH user's name, which the sudo password prompt names. */
  user: string
  /** How to reach the host, before `sudo` is set up on it. */
  baseTransport: Transport
  /** Runs preparation's commands on the host, recording them, like the sudo password prompt's checks. */
  hostShell: Shell
}

/** A host's details once its transport is built. A host whose sudo password needs a prompt gets it after the prompt. */
export interface ReadyHostDetails extends HostDetails {
  transport: Transport
}

// Read `$HOME` with `printf '%s'`, because it prints the value exactly, with no newline to strip.
// `echo` treats backslashes or a leading `-n` specially in some shells.
const READ_HOME_COMMAND = `printf '%s' "$HOME"`
const READ_USER_COMMAND = "id -un"

/**
 * Returns how to reach `target`, without `sudo` set up yet. Reads the ssh config first for a target that goes over ssh,
 * with `localShell`, so the transport fills in only what the config leaves at ssh's defaults.
 */
export const prepareBaseTransport = async (localShell: Shell, target: string): Promise<Result<Transport>> => {
  if (target === LOCAL_TARGET) return getLocalTransport()

  const sshOptions = await readSshDefaultOptions(localShell, target)
  if (isErr(sshOptions)) return sshOptions

  return getSshTransport(target, sshOptions)
}

/**
 * Sets up how to reach the host, reads what its session needs, and sets up `sudo` on it, recording each command on
 * `preparationRecorder`. Fails when the host can't run commands at all, or when it declares `sudo` and sudo doesn't
 * work. A host whose sudo password needs a prompt gets no transport yet.
 */
export const buildHostDetails = async (
  loadedHost: LoadedHost,
  preparationRecorder: PreparationRecorder,
): Promise<Result<HostDetails | ReadyHostDetails>> => {
  const { target, options } = loadedHost
  const { sudo } = options

  // Build the host's shell only once there's a transport to reach it, because an ssh target's comes from its config.
  const localShell = preparationRecorder.getShell(getLocalTransport())

  const baseTransport = await prepareBaseTransport(localShell, target)
  if (isErr(baseTransport)) return baseTransport
  const hostShell = preparationRecorder.getShell(baseTransport)

  // Read the SSH user's home before the script runs, because a path that starts with `~/` needs it.
  // An unset `$HOME` comes back empty, so this fails only when the host can't run commands at all.
  const home = await hostShell.exec(READ_HOME_COMMAND, { label: "home directory" })
  if (isErr(home)) return err("failed to read the SSH user's home directory", home)

  const userOutput = await hostShell.exec(READ_USER_COMMAND, { label: "user name" })
  if (isErr(userOutput)) return err("failed to read the SSH user's name", userOutput)
  const user = userOutput.trim()

  const resolvedSudo = await resolveHostSudo(hostShell, sudo)
  if (isErr(resolvedSudo)) return resolvedSudo

  // Skip writing the askpass helper for hosts where passwordless sudo is enabled.
  if (resolvedSudo.kind !== "passwordless") {
    const helperWrite = await hostShell.exec(WRITE_ASKPASS_HELPER_SCRIPT, { label: "askpass helper write" })
    if (isErr(helperWrite)) return err("failed to write the sudo askpass helper", helperWrite)
  }

  if (resolvedSudo.kind === "needsPassword") return { home, user, baseTransport, hostShell }

  const transport =
    resolvedSudo.kind === "password"
      ? createAskpassSudoTransport(baseTransport, resolvedSudo.password)
      : createPasswordlessSudoTransport(baseTransport)

  return { home, user, baseTransport, hostShell, transport }
}

/**
 * Prompts for the sudo password of a host that `buildHostDetails` found needs one, and returns its details with the
 * transport that gives sudo the password. `buildHostDetails` already wrote the askpass helper.
 */
export const finishHostDetails = async (
  loadedHost: LoadedHost,
  hostDetails: HostDetails,
): Promise<Result<ReadyHostDetails>> => {
  const { user, baseTransport, hostShell } = hostDetails

  const password = await promptForSudoPassword(hostShell, loadedHost.name, user)
  if (isErr(password)) return password

  const transport = createAskpassSudoTransport(baseTransport, password)
  return { ...hostDetails, transport }
}
