import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { LoadedHost } from "#core/hosts/load.ts"
import type { HostFacts } from "#core/hosts/prepare/host-details/facts.ts"
import { readHostFacts } from "#core/hosts/prepare/host-details/facts.ts"
import { promptForSudoPassword } from "#core/hosts/prepare/host-details/host-sudo/prompt.ts"
import { resolveHostSudo } from "#core/hosts/prepare/host-details/host-sudo/resolve.ts"
import { readSshDefaultOptions } from "#core/hosts/prepare/host-details/ssh-options.ts"
import { toAskpassHelperPath } from "#core/hosts/prepare/host-details/tsinfra-directory.ts"
import type { PreparationRecorder } from "#core/session/recorder/preparation-recorder.ts"
import type { Transport } from "#core/transport.ts"
import { LOCAL_TARGET, getLocalTransport, getSshTransport } from "#core/transport.ts"
import type { Shell } from "#core/transport/shell.ts"
import {
  buildAskpassHelperWriteScript,
  createAskpassSudoTransport,
  createPasswordlessSudoTransport,
} from "#core/transport/sudo.ts"

/** What preparation reads from a host. A host whose sudo password needs a prompt gets no transport until the prompt. */
export type HostDetails = NeedsPasswordHostDetails | ReadyHostDetails

/** A host's details while its sudo password still needs a prompt, so it has no transport yet. */
export interface NeedsPasswordHostDetails extends BaseHostDetails {
  kind: "needsPassword"
}

/** A host's details once its transport is built. */
export interface ReadyHostDetails extends BaseHostDetails {
  kind: "ready"
  transport: Transport
  /** The password the transport gives sudo, from `host()` or the prompt. It's undefined on a host that has none. */
  sudoPassword: string | undefined
}

/** What preparation reads from every host, whether or not its transport is built yet. */
interface BaseHostDetails {
  /** What the session gives the script as `h.facts`, the SSH user's home among them. */
  facts: HostFacts
  /** The SSH user's name, which the sudo password prompt names. */
  user: string
  /** How to reach the host, before `sudo` is set up on it. */
  baseTransport: Transport
  /** Runs preparation's commands on the host, recording them, like the sudo password prompt's checks. */
  hostShell: Shell
}

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
): Promise<Result<HostDetails>> => {
  const { target, options } = loadedHost
  const { sudo } = options

  // Build the host's shell only once there's a transport to reach it, because an ssh target's comes from its config.
  const localShell = preparationRecorder.getShell(getLocalTransport())

  const baseTransport = await prepareBaseTransport(localShell, target)
  if (isErr(baseTransport)) return baseTransport
  const hostShell = preparationRecorder.getShell(baseTransport)

  const readFacts = await readHostFacts(hostShell)
  if (isErr(readFacts)) return readFacts
  const { facts, warnings } = readFacts
  preparationRecorder.recordWarnings(warnings)

  const userOutput = await hostShell.exec(READ_USER_COMMAND, { label: "user name" })
  if (isErr(userOutput)) return err("failed to read the SSH user's name", userOutput)
  const user = userOutput.trim()

  const resolvedSudo = await resolveHostSudo(hostShell, sudo)
  if (isErr(resolvedSudo)) return resolvedSudo

  const askpassHelperPath = toAskpassHelperPath(facts.home)

  // Skip writing the askpass helper for hosts where passwordless sudo is enabled.
  if (resolvedSudo.kind !== "passwordless") {
    const helperWriteScript = buildAskpassHelperWriteScript(askpassHelperPath)
    const helperWrite = await hostShell.exec(helperWriteScript, { label: "askpass helper write" })
    if (isErr(helperWrite)) return err("failed to write the sudo askpass helper", helperWrite)
  }

  if (resolvedSudo.kind === "needsPassword") return { kind: "needsPassword", facts, user, baseTransport, hostShell }

  if (resolvedSudo.kind === "password") {
    const { password } = resolvedSudo
    const transport = createAskpassSudoTransport(baseTransport, password, askpassHelperPath)
    return { kind: "ready", facts, user, baseTransport, hostShell, transport, sudoPassword: password }
  }

  const transport = createPasswordlessSudoTransport(baseTransport)
  return { kind: "ready", facts, user, baseTransport, hostShell, transport, sudoPassword: undefined }
}

/**
 * Prompts for the sudo password of a host that `buildHostDetails` found needs one, and returns its details with the
 * transport that gives sudo the password. `buildHostDetails` already wrote the askpass helper.
 */
export const finishHostDetails = async (
  loadedHost: LoadedHost,
  hostDetails: NeedsPasswordHostDetails,
): Promise<Result<ReadyHostDetails>> => {
  const { facts, user, baseTransport, hostShell } = hostDetails

  const password = await promptForSudoPassword(hostShell, loadedHost.name, user)
  if (isErr(password)) return password

  const transport = createAskpassSudoTransport(baseTransport, password, toAskpassHelperPath(facts.home))
  return { ...hostDetails, kind: "ready", transport, sudoPassword: password }
}
