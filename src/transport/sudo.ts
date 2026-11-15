import path from "node:path"

import type { Transport } from "#transport/transport.ts"
import { quoteShellArg } from "#utils.ts"

const SUDO_PASSWORD_VARIABLE = "TSINFRA_SUDO_PASSWORD"

// Print the password from a variable, so the helper itself holds no secret.
// sudo runs it with the caller's environment, which the Docker tests check on Alpine and Debian.
const ASKPASS_HELPER = `#!/bin/sh\nprintf '%s\\n' "$${SUDO_PASSWORD_VARIABLE}"\n`

/**
 * Returns the script that writes the askpass helper to `helperPath`, replacing the one from an earlier run. Write it
 * under a temp name and rename it into place, because another host on the same machine can be running it while
 * preparation writes it.
 */
export const buildAskpassHelperWriteScript = (helperPath: string): string => {
  const quotedHelperPath = quoteShellArg(helperPath)
  return [
    "set -eu",
    `mkdir -p -m 700 ${quoteShellArg(path.posix.dirname(helperPath))}`,
    `tmp=${quotedHelperPath}.$$`,
    `printf '%s' ${quoteShellArg(ASKPASS_HELPER)} >"$tmp"`,
    `chmod 700 "$tmp"`,
    `mv -f "$tmp" ${quotedHelperPath}`,
  ].join("\n")
}

// Use `-n`, because a `sudo` that needs a password would otherwise prompt on a local terminal, in the middle of the report.
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
