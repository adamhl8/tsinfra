import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Shell } from "#transport/transport.ts"
import { createCommandExitError, quoteShellArg } from "#utils.ts"

export const INCORRECT_SUDO_PASSWORD_MESSAGE = "incorrect sudo password"
export const SUDO_PASSWORD_CHECK_FAILED_MESSAGE = "failed to check the sudo password"

// Record this in place of the password, so the password never reaches the record.
const RECORDED_PASSWORD = "<sudo password>"

/**
 * Returns the script that checks a password with sudo, ignoring cached credentials, with `passwordArg` as the password
 * argument. Give sudo the password on stdin with `-S`, because sudo then makes one try and stops at the end of stdin.
 * Through askpass, it makes three tries and logs three failures. Use `-p ''`, so sudo prints no prompt of its own.
 */
const buildCheckSudoPasswordScript = (passwordArg: string): string =>
  `printf '%s\\n' ${passwordArg} | sudo -k -S -p '' true`

/**
 * Checks `password` with sudo and returns whether sudo accepted it. Fails with sudo's output when sudo fails for
 * another reason, like a user who isn't in sudoers, because then the password may well be right.
 */
export const checkSudoPassword = async (shell: Shell, password: string): Promise<Result<boolean>> => {
  const output = await shell.inspect(buildCheckSudoPasswordScript(quoteShellArg(password)), {
    recordedCmd: buildCheckSudoPasswordScript(RECORDED_PASSWORD),
  })
  if (isErr(output)) return err(SUDO_PASSWORD_CHECK_FAILED_MESSAGE, output)
  if (output.exitCode !== 0) {
    // Match the line sudo ends a wrong password with, like `sudo: 1 incorrect password attempt`.
    if (output.stderr.includes("incorrect password attempt")) return false
    return err(SUDO_PASSWORD_CHECK_FAILED_MESSAGE, createCommandExitError(output))
  }

  return true
}
