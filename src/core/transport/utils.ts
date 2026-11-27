import crypto from "node:crypto"

import { HEREDOC_DELIMITER, quoteShellArg } from "#core/utils.ts"

// `sh -s` runs each line as soon as it reads it, and that line's command shares the shell's stdin.
// In `cat\necho after`, `cat` reads `echo after` as its input, so `echo after` never runs.
// Wrap `cmd` in a group so the shell reads all of it before running any of it.
// Give the group /dev/null as stdin so its commands can't read the rest of `cmd` either.
export const wrapCommand = (cmd: string) => `{ ${cmd}\n} </dev/null`

/**
 * Wraps `cmd` so its stdin is `input`, decoded from base64 in a heredoc. Put the heredoc's body before `cmd`, because
 * the body starts at the next newline, and `cmd` can span lines.
 */
export const wrapCommandWithInput = (cmd: string, input: Uint8Array) => {
  const encodedInput = input.toBase64()
  return `base64 -d <<'${HEREDOC_DELIMITER}' |\n${encodedInput}\n${HEREDOC_DELIMITER}\n{ ${cmd}\n}`
}

/** Starts `cmd` with an `export` line for each of `variables`, single-quoting each value so it stays literal. */
export const addEnvPrelude = (cmd: string, variables: Record<string, string>): string => {
  const exportLines = Object.entries(variables).map(([name, value]) => `export ${name}=${quoteShellArg(value)}\n`)
  return `${exportLines.join("")}${cmd}`
}

/**
 * Wraps `script` to run as root, in a `sh -s` under `sudo`. Send the script on stdin, so it's never in `ps` or the sudo
 * log. Use a random delimiter, because a path in the script can hold any line, even one matching a fixed delimiter.
 */
export const wrapInRootShell = (script: string): string => {
  const delimiter = `__TSINFRA_SUDO_${crypto.randomUUID()}__`
  return `sudo sh -s <<'${delimiter}'\n${wrapCommand(script)}\n${delimiter}`
}
