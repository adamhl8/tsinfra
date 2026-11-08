import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { LoadedHost } from "#hosts/load.ts"
import { promptForSudoPassword, resolveHostSudo } from "#session/host-details/host-sudo.ts"
import { createShell } from "#session/shell.ts"
import {
  WRITE_ASKPASS_HELPER_SCRIPT,
  createAskpassSudoTransport,
  createPasswordlessSudoTransport,
} from "#transport/sudo.ts"
import type { Transport } from "#transport/transport.ts"
import { getTransport } from "#transport/transport.ts"

/** What preflight reads from a host before its transport is built. */
export interface HostDetails {
  /** The SSH user's home directory. It's empty when `$HOME` isn't set. */
  home: string
  /** The SSH user's name, which the sudo password prompt names. */
  user: string
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
 * Sets up how to reach the host and reads what its session needs. Fails when the host can't run commands at all, or
 * when it declares `sudo` and sudo doesn't work. A host whose sudo password needs a prompt gets no transport yet.
 */
export const buildHostDetails = async (loadedHost: LoadedHost): Promise<Result<HostDetails | ReadyHostDetails>> => {
  const { target, options } = loadedHost
  const { sudo } = options
  const baseTransport = getTransport(target)
  const shell = createShell(baseTransport)

  // Read the SSH user's home before the script runs, because a path that starts with `~/` needs it.
  // An unset `$HOME` comes back empty, so this fails only when the host can't run commands at all.
  const home = await shell.exec(READ_HOME_COMMAND)
  if (isErr(home)) return err("failed to read the SSH user's home directory", home)

  const userOutput = await shell.exec(READ_USER_COMMAND)
  if (isErr(userOutput)) return err("failed to read the SSH user's name", userOutput)
  const user = userOutput.trim()

  const resolvedSudo = await resolveHostSudo(shell, sudo)
  if (isErr(resolvedSudo)) return resolvedSudo

  // Skip writing the askpass helper for hosts where passwordless sudo is enabled.
  if (resolvedSudo.kind !== "passwordless") {
    const helperWrite = await shell.exec(WRITE_ASKPASS_HELPER_SCRIPT)
    if (isErr(helperWrite)) return err("failed to write the sudo askpass helper", helperWrite)
  }

  if (resolvedSudo.kind === "needsPassword") return { home, user }

  const transport =
    resolvedSudo.kind === "password"
      ? createAskpassSudoTransport(baseTransport, resolvedSudo.password)
      : createPasswordlessSudoTransport(baseTransport)
  return { home, user, transport }
}

/**
 * Prompts for the sudo password of a host that `buildHostDetails` found needs one, and returns its details with the
 * transport that gives sudo the password. `buildHostDetails` already wrote the askpass helper.
 */
export const finishHostDetails = async (
  loadedHost: LoadedHost,
  hostDetails: HostDetails,
): Promise<Result<ReadyHostDetails>> => {
  const { name, target } = loadedHost
  const { home, user } = hostDetails
  const baseTransport = getTransport(target)
  const shell = createShell(baseTransport)

  const password = await promptForSudoPassword(shell, name, user)
  if (isErr(password)) return password

  const transport = createAskpassSudoTransport(baseTransport, password)
  return { home, user, transport }
}
