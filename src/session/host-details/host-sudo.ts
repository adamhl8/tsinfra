import process from "node:process"

import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HostSudo } from "#hosts/host.ts"
import { readHiddenLine } from "#session/host-details/read-hidden-line.ts"
import type { Shell } from "#session/shell.ts"
import { quoteShellArg } from "#transport/quote.ts"

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

/** What preflight found out about the host's sudo. */
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
    const passwordCheck = await shell.exec(buildCheckSudoPasswordScript(password))
    if (isErr(passwordCheck)) return err("incorrect sudo password", passwordCheck)

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

const SUDO_PASSWORD_TRIES = 3

/**
 * Prompts for the sudo password of the host `name` up to three times, like sudo itself, and checks each one. Returns
 * the right password. Fails when the host is skipped with Ctrl-D, or after three wrong tries.
 */
export const promptForSudoPassword = async (shell: Shell, name: string, user: string): Promise<Result<string>> => {
  const prompt = `To run host '${name}', enter the sudo password for '${user}' (press Ctrl-D to skip this host, or Ctrl-C to cancel the entire run): `

  let passwordCheckFailure: Error | undefined
  for (let tryNumber = 1; tryNumber <= SUDO_PASSWORD_TRIES; tryNumber++) {
    if (tryNumber > 1) process.stderr.write("Sorry, try again.\n")

    // oxlint-disable-next-line no-await-in-loop - each try waits for the person to type
    const password = await readHiddenLine(prompt)
    if (password === undefined) return err("skipped sudo password prompt", undefined)

    // oxlint-disable-next-line no-await-in-loop - each try waits for the person to type
    const check = await shell.exec(buildCheckSudoPasswordScript(password))
    if (!isErr(check)) return password
    passwordCheckFailure = check
  }

  return err("incorrect sudo password", passwordCheckFailure)
}
