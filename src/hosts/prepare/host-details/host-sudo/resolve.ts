import process from "node:process"

import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HostSudo } from "#hosts/host.ts"
import {
  checkSudoPassword,
  INCORRECT_SUDO_PASSWORD_MESSAGE,
} from "#hosts/prepare/host-details/host-sudo/check-password.ts"
import type { Shell } from "#transport/transport.ts"

// Use `-n`, so sudo fails instead of asking, and `-k`, so it ignores cached credentials.
const CHECK_PASSWORDLESS_SUDO_COMMAND = "sudo -n -k true"

const NEEDS_SUDO_PASSWORD_MESSAGE =
  "needs a sudo password: set up passwordless sudo, or pass sudo: { password } to host()"

/** What preparation found out about the host's sudo. */
export type ResolvedHostSudo =
  | { kind: "passwordless" }
  | { kind: "password"; password: string }
  | { kind: "needsPassword" }

/**
 * Checks that the host's `sudo` option works on the host, and returns what the host's `sudo` needs. A `sudo: true` host
 * whose sudo needs a password needs a prompt, and fails when there's no terminal to prompt on. `shell` has no `sudo`
 * function, so the checks run the real `sudo`.
 */
export const resolveHostSudo = async (shell: Shell, sudo: HostSudo): Promise<Result<ResolvedHostSudo>> => {
  if (typeof sudo === "object") {
    const { password } = sudo
    const isAccepted = await checkSudoPassword(shell, password)
    if (isErr(isAccepted)) return isAccepted
    if (!isAccepted) return err(INCORRECT_SUDO_PASSWORD_MESSAGE, undefined)

    return { kind: "password", password }
  }

  if (sudo) {
    const sudoCheck = await shell.exec(CHECK_PASSWORDLESS_SUDO_COMMAND)
    if (isErr(sudoCheck)) {
      // Check stderr too, because the prompt goes there, and a run with stderr redirected would wait on a prompt nobody
      // sees.
      const canPrompt = process.stdin.isTTY && process.stderr.isTTY
      if (!canPrompt) return err(NEEDS_SUDO_PASSWORD_MESSAGE, sudoCheck)

      return { kind: "needsPassword" }
    }
  }

  return { kind: "passwordless" }
}
