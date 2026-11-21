import type { Transport } from "#core/transport.ts"
import { buildPrivateFileWriteScript, quoteShellArg } from "#utils.ts"

const SUDO_PASSWORD_VARIABLE = "TSINFRA_SUDO_PASSWORD"

// Print the password from a variable, so the helper itself holds no secret.
// sudo runs it with the caller's environment, which the Docker tests check on Alpine and Debian.
const ASKPASS_HELPER = `#!/bin/sh\nprintf '%s\\n' "$${SUDO_PASSWORD_VARIABLE}"\n`

/**
 * Returns the script that writes the askpass helper to `helperPath`, replacing the one from an earlier run. The write
 * renames a temp file into place, because another host on the same machine can be running the helper meanwhile.
 */
export const buildAskpassHelperWriteScript = (helperPath: string): string =>
  buildPrivateFileWriteScript(helperPath, ASKPASS_HELPER, { executable: true })

// Use `-n`, so a `sudo` that needs a password fails with only `a password is required`.
// It also never runs an askpass helper that the host's own environment sets along with `DISPLAY`.
const PASSWORDLESS_SUDO_FUNCTION = `sudo() { command sudo -n "$@"; }`

/** Returns the `sudo` function that gives sudo `password` through the askpass helper at `helperPath`. */
const buildAskpassSudoFunction = (password: string, helperPath: string): string =>
  `sudo() { ${SUDO_PASSWORD_VARIABLE}=${quoteShellArg(password)} SUDO_ASKPASS=${quoteShellArg(helperPath)} command sudo -A "$@"; }`

/**
 * Starts every script with `sudoFunction`, which a script's own `sudo` calls. The recorder sees each command before
 * this adds the function, so it's never on the record.
 */
const withSudoFunction =
  (transport: Transport, sudoFunction: string): Transport =>
  async (cmd) =>
    transport(`${sudoFunction}\n${cmd}`)

/** Returns a transport whose scripts' `sudo` fails instead of asking for a password. */
export const createPasswordlessSudoTransport = (transport: Transport): Transport =>
  withSudoFunction(transport, PASSWORDLESS_SUDO_FUNCTION)

/** Returns a transport whose scripts' `sudo` gets `password` through the askpass helper at `helperPath`. */
export const createAskpassSudoTransport = (transport: Transport, password: string, helperPath: string): Transport =>
  withSudoFunction(transport, buildAskpassSudoFunction(password, helperPath))
