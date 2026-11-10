import process from "node:process"

import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import {
  checkSudoPassword,
  INCORRECT_SUDO_PASSWORD_MESSAGE,
  SUDO_PASSWORD_CHECK_FAILED_MESSAGE,
} from "#hosts/prepare/host-details/host-sudo/check-password.ts"
import { readHiddenLine } from "#hosts/prepare/host-details/host-sudo/read-hidden-line.ts"
import { styleAside, styleValue, styleWarning } from "#styles.ts"
import type { Shell } from "#transport/transport.ts"

const SUDO_PASSWORD_TRIES = 3
const PASSWORD_PROMPT = "Password: "
const SKIPPED_SUDO_PASSWORD_PROMPT_MESSAGE = "skipped sudo password prompt"
const SKIPPING_HOST = "skipping host"

/** Warns that preparation moves on to the next host, with a blank line before that host's prompt. */
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
