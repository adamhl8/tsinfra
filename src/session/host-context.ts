import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { LoadedHost } from "#hosts/load.ts"
import { createShell } from "#session/shell.ts"
import { WRITE_ASKPASS_HELPER_SCRIPT } from "#transport/sudo.ts"
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

// Use `-k`, so sudo ignores cached credentials. Through the `-n` function, it works only when sudo needs no password.
// Through the askpass function, it works only when sudo accepts the password.
const CHECK_SUDO_COMMAND = "sudo -k true"

const NEEDS_SUDO_PASSWORD_MESSAGE =
  "needs a sudo password: set up passwordless sudo, or pass sudo: { password } to host()"

/**
 * Sets up how to reach the host and reads what the session needs. Fails when the host can't run commands at all, or
 * when it declares `sudo` and sudo doesn't work.
 */
export const buildHostContext = async (loadedHost: LoadedHost): Promise<Result<HostContext>> => {
  const { name, target, options } = loadedHost
  const { sudo } = options
  const transport = getTransport(target, sudo)
  const shell = createShell(transport)

  // Read the SSH user's home before the script runs, because a path that starts with `~/` needs it.
  // An unset `$HOME` comes back empty, so this fails only when the host can't run commands at all.
  const home = await shell.exec(READ_HOME_COMMAND)
  if (isErr(home)) return err("failed to read the SSH user's home directory", home)

  if (typeof sudo === "object") {
    const helperWrite = await shell.exec(WRITE_ASKPASS_HELPER_SCRIPT)
    if (isErr(helperWrite)) return err("failed to write the sudo askpass helper", helperWrite)
  }

  if (sudo !== false) {
    const sudoCheck = await shell.exec(CHECK_SUDO_COMMAND)
    if (isErr(sudoCheck)) return err(sudo === true ? NEEDS_SUDO_PASSWORD_MESSAGE : "incorrect sudo password", sudoCheck)
  }

  return { name, transport, home }
}
