import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { LoadedHost } from "#hosts/load.ts"
import { resolveHostSudo } from "#session/host-context/host-sudo.ts"
import { createShell } from "#session/shell.ts"
import type { Transport } from "#transport/transport.ts"
import { getTransport } from "#transport/transport.ts"

/** What a host's session needs, set up before any script runs. */
export interface HostContext {
  name: string
  transport: Transport
  /** The SSH user's home directory. It's empty when `$HOME` isn't set. */
  home: string
}

// Read `$HOME` with `printf '%s'`, because it prints the value exactly, with no newline to strip.
// `echo` treats backslashes or a leading `-n` specially in some shells.
const READ_HOME_COMMAND = `printf '%s' "$HOME"`

/**
 * Sets up how to reach the host and reads what the session needs. Fails when the host can't run commands at all, or
 * when it declares `sudo` and sudo doesn't work.
 */
export const buildHostContext = async (loadedHost: LoadedHost): Promise<Result<HostContext>> => {
  const { name, target, options } = loadedHost
  const { sudo } = options
  const baseTransport = getTransport(target)
  const shell = createShell(baseTransport)

  // Read the SSH user's home before the script runs, because a path that starts with `~/` needs it.
  // An unset `$HOME` comes back empty, so this fails only when the host can't run commands at all.
  const home = await shell.exec(READ_HOME_COMMAND)
  if (isErr(home)) return err("failed to read the SSH user's home directory", home)

  const transport = await resolveHostSudo(baseTransport, sudo)
  if (isErr(transport)) return transport

  return { name, transport, home }
}
