import type { Transport } from "#transport/transport.ts"
import { quoteShellArg } from "#utils.ts"

const SUDO_PASSWORD_VARIABLE = "TSINFRA_SUDO_PASSWORD"

// Print the password from a variable, so the helper itself holds no secret.
// sudo runs it with the caller's environment, which the Docker tests check on Alpine and Debian.
const ASKPASS_HELPER = `#!/bin/sh\nprintf '%s\\n' "$${SUDO_PASSWORD_VARIABLE}"\n`

// Keep the helper in the SSH user's home, because sudo can't run a helper from a `/tmp` mounted `noexec`.
// It holds no secret, so it stays there between runs.
const ASKPASS_DIRECTORY = `"$HOME"/.tsinfra`
const ASKPASS_HELPER_PATH = `${ASKPASS_DIRECTORY}/askpass.sh`

/**
 * Writes the askpass helper, replacing the one from an earlier run. Write it under a temp name and rename it into
 * place, because another host on the same machine can be running it while preparation writes it.
 */
export const WRITE_ASKPASS_HELPER_SCRIPT = [
  "set -eu",
  `mkdir -p -m 700 ${ASKPASS_DIRECTORY}`,
  `tmp=${ASKPASS_HELPER_PATH}.$$`,
  `printf '%s' ${quoteShellArg(ASKPASS_HELPER)} >"$tmp"`,
  `chmod 700 "$tmp"`,
  `mv -f "$tmp" ${ASKPASS_HELPER_PATH}`,
].join("\n")

// Use `-n`, because a `sudo` that needs a password would otherwise prompt on a local terminal, in the middle of the report.
const PASSWORDLESS_SUDO_FUNCTION = `sudo() { command sudo -n "$@"; }`

/** Returns the `sudo` function that gives sudo `password` through the askpass helper. */
const buildAskpassSudoFunction = (password: string): string =>
  `sudo() { ${SUDO_PASSWORD_VARIABLE}=${quoteShellArg(password)} SUDO_ASKPASS=${ASKPASS_HELPER_PATH} command sudo -A "$@"; }`

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

/** Returns a transport whose scripts' `sudo` gets `password` through the askpass helper. */
export const createAskpassSudoTransport = (transport: Transport, password: string): Transport =>
  withSudoFunction(transport, buildAskpassSudoFunction(password))
