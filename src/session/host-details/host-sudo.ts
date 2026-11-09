import process from "node:process"

import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HostSudo } from "#hosts/host.ts"
import { styleAside, styleValue, styleWarning } from "#report/format/styles.ts"
import { readHiddenLine } from "#session/host-details/read-hidden-line.ts"
import type { Shell } from "#session/shell.ts"
import { quoteShellArg } from "#transport/quote.ts"
import { createCommandExitError } from "#utils.ts"

// Use `-n`, so sudo fails instead of asking, and `-k`, so it ignores cached credentials.
const CHECK_PASSWORDLESS_SUDO_COMMAND = "sudo -n -k true"

/**
 * Returns the script that checks `password` with sudo, ignoring cached credentials. Give sudo the password on stdin
 * with `-S`, because sudo then makes one try and stops at the end of stdin. Through askpass, it makes three tries and
 * logs three failures. Use `-p ''`, so sudo prints no prompt of its own.
 */
const buildCheckSudoPasswordScript = (password: string): string =>
  `printf '%s\\n' ${quoteShellArg(password)} | sudo -k -S -p '' true`

const INCORRECT_SUDO_PASSWORD_MESSAGE = "incorrect sudo password"
const SUDO_PASSWORD_CHECK_FAILED_MESSAGE = "failed to check the sudo password"
const NEEDS_SUDO_PASSWORD_MESSAGE =
  "needs a sudo password: set up passwordless sudo, or pass sudo: { password } to host()"

/**
 * Checks `password` with sudo and returns whether sudo accepted it. Fails with sudo's output when sudo fails for
 * another reason, like a user who isn't in sudoers, because then the password may well be right.
 */
const checkSudoPassword = async (shell: Shell, password: string): Promise<Result<boolean>> => {
  const output = await shell.inspect(buildCheckSudoPasswordScript(password))
  if (isErr(output)) return err(SUDO_PASSWORD_CHECK_FAILED_MESSAGE, output)
  if (output.exitCode !== 0) {
    // Match the line sudo ends a wrong password with, like `sudo: 1 incorrect password attempt`.
    if (output.stderr.includes("incorrect password attempt")) return false
    return err(SUDO_PASSWORD_CHECK_FAILED_MESSAGE, createCommandExitError(output))
  }

  return true
}

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

const SUDO_PASSWORD_TRIES = 3
const PASSWORD_PROMPT = "Password: "
const SKIPPED_SUDO_PASSWORD_PROMPT_MESSAGE = "skipped sudo password prompt"
const SKIPPING_HOST = "skipping host"

/** Warns that preflight moves on to the next host, with a blank line before that host's prompt. */
const warnSkippingHost = (warning: string) => {
  process.stderr.write(`${styleWarning(warning)}\n\n`)
}

/**
 * Prompts for the sudo password of the host `name` up to three times, like sudo itself, and checks each one. Returns
 * the right password. Fails when the host is skipped with Ctrl-D, after three wrong tries, or at once when sudo fails
 * for another reason, because typing again won't help.
 */
export const promptForSudoPassword = async (shell: Shell, name: string, user: string): Promise<Result<string>> => {
  // Say which host and user once, then ask with only `Password:` on each try, so the prompt reads like sudo's own.
  // Pass them as part of the first prompt, because the reader prints its prompt only once nothing typed is echoed.
  const promptHeader = [
    styleAside("Ctrl-D to skip this host · Ctrl-C to cancel the entire run"),
    `To run host '${styleValue(name)}', enter the sudo password for user '${styleValue(user)}'.`,
  ].join("\n")

  for (let tryNumber = 1; tryNumber <= SUDO_PASSWORD_TRIES; tryNumber++) {
    if (tryNumber > 1) process.stderr.write("Sorry, try again.\n")
    const prompt = tryNumber === 1 ? `${promptHeader}\n${PASSWORD_PROMPT}` : PASSWORD_PROMPT

    // oxlint-disable-next-line no-await-in-loop - each try waits for the person to type
    const password = await readHiddenLine(prompt)
    if (password === undefined) {
      warnSkippingHost(SKIPPING_HOST)
      return err(SKIPPED_SUDO_PASSWORD_PROMPT_MESSAGE, undefined)
    }

    // oxlint-disable-next-line no-await-in-loop - each try waits for the person to type
    const isAccepted = await checkSudoPassword(shell, password)
    if (isErr(isAccepted)) {
      warnSkippingHost(`${SUDO_PASSWORD_CHECK_FAILED_MESSAGE}, ${SKIPPING_HOST}`)
      return isAccepted
    }

    if (isAccepted) {
      // Leave a blank line before the next host's prompt, the same as after a skipped host.
      process.stderr.write("\n")
      return password
    }
  }

  // Say so before the next host's prompt, in the error's own words, because after the last try nothing else shows it.
  warnSkippingHost(`${INCORRECT_SUDO_PASSWORD_MESSAGE}, ${SKIPPING_HOST}`)
  return err(INCORRECT_SUDO_PASSWORD_MESSAGE, undefined)
}
