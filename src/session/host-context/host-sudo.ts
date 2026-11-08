import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HostSudo } from "#hosts/host.ts"
import { createShell } from "#session/shell.ts"
import { quoteShellArg } from "#transport/quote.ts"
import {
  WRITE_ASKPASS_HELPER_SCRIPT,
  createAskpassSudoTransport,
  createNoPasswordSudoTransport,
} from "#transport/sudo.ts"
import type { Transport } from "#transport/transport.ts"

// Use `-n`, so sudo fails instead of asking, and `-k`, so it ignores cached credentials.
const CHECK_PASSWORDLESS_SUDO_COMMAND = "sudo -n -k true"

/**
 * Returns the script that checks `password` with sudo, ignoring cached credentials. Give sudo the password on stdin
 * with `-S`, because sudo then makes one try and stops at the end of stdin. Through askpass, it makes three tries and
 * logs three failures. Use `-p ''`, so sudo prints no prompt of its own.
 */
const buildCheckSudoPasswordScript = (password: string): string =>
  `printf '%s\\n' ${quoteShellArg(password)} | sudo -k -S -p '' true`

const NEEDS_SUDO_PASSWORD_MESSAGE =
  "needs a sudo password: set up passwordless sudo, or pass sudo: { password } to host()"

/**
 * Checks that the host's `sudo` option works on the host, and returns the transport with the `sudo` function the option
 * needs. `transport` has no `sudo` function, so the checks run the real `sudo`.
 */
export const resolveHostSudo = async (transport: Transport, sudo: HostSudo): Promise<Result<Transport>> => {
  const shell = createShell(transport)

  if (typeof sudo === "object") {
    const { password } = sudo
    const passwordCheck = await shell.exec(buildCheckSudoPasswordScript(password))
    if (isErr(passwordCheck)) return err("incorrect sudo password", passwordCheck)

    const helperWrite = await shell.exec(WRITE_ASKPASS_HELPER_SCRIPT)
    if (isErr(helperWrite)) return err("failed to write the sudo askpass helper", helperWrite)

    return createAskpassSudoTransport(transport, password)
  }

  if (sudo) {
    const sudoCheck = await shell.exec(CHECK_PASSWORDLESS_SUDO_COMMAND)
    if (isErr(sudoCheck)) return err(NEEDS_SUDO_PASSWORD_MESSAGE, sudoCheck)
  }

  return createNoPasswordSudoTransport(transport)
}
