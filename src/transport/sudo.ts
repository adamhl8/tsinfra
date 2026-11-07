import crypto from "node:crypto"

import type { Transport } from "#transport/transport.ts"
import { wrapScript } from "#transport/wrap-script.ts"

// Use `-n`, because a `sudo` that needs a password would otherwise prompt on a local terminal, in the middle of the report.
const SUDO_PREAMBLE = `sudo() { command sudo -n "$@"; }`

/** Starts every script with the `sudo` function, below the recorder, so it's never on the record. */
export const withSudoPreamble =
  (transport: Transport): Transport =>
  async (script) =>
    transport(`${SUDO_PREAMBLE}\n${script}`)

/**
 * Runs each script as root, in a `sh -s` under `sudo`. Send the script on stdin, so it's never in `ps` or the sudo log.
 * Use a random delimiter, because a path in the script can hold any line, even one matching a fixed delimiter.
 */
export const createSudoTransport =
  (transport: Transport): Transport =>
  async (script) => {
    const delimiter = `__TSINFRA_SUDO_${crypto.randomUUID()}__`
    return transport(`sudo sh -s <<'${delimiter}'\n${wrapScript(script)}\n${delimiter}`)
  }
