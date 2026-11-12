import crypto from "node:crypto"

import type { Transport } from "#transport/transport.ts"
import { wrapCommand } from "#transport/utils.ts"
import { quoteShellArg } from "#utils.ts"

/** The options that change how every command in a step runs. */
export interface StepShellOptions {
  /** Whether every command runs as root, in a `sudo sh -s`. */
  sudo: boolean
  /** The variables exported to every command. */
  env: Record<string, string>
  /** The variables exported to every command, whose values never show. */
  secretEnv: Record<string, string>
}

/** Starts `cmd` with an `export` line for each of `variables`, single-quoting each value so it stays literal. */
const addEnvPrelude = (cmd: string, variables: Record<string, string>): string => {
  const exportLines = Object.entries(variables).map(([name, value]) => `export ${name}=${quoteShellArg(value)}\n`)
  return `${exportLines.join("")}${cmd}`
}

/**
 * Wraps `script` to run as root, in a `sh -s` under `sudo`. Send the script on stdin, so it's never in `ps` or the sudo
 * log. Use a random delimiter, because a path in the script can hold any line, even one matching a fixed delimiter.
 */
const wrapInRootShell = (script: string): string => {
  const delimiter = `__TSINFRA_SUDO_${crypto.randomUUID()}__`
  return `sudo sh -s <<'${delimiter}'\n${wrapCommand(script)}\n${delimiter}`
}

/**
 * Returns a transport that runs each command with a step's `options`. Add the prelude before the root shell wraps the
 * command, so the variables are set inside the root shell, and sudo's reset of the environment can't drop them.
 */
export const createStepTransport =
  (transport: Transport, { sudo, env, secretEnv }: StepShellOptions): Transport =>
  async (cmd) => {
    const script = addEnvPrelude(cmd, { ...env, ...secretEnv })
    return transport(sudo ? wrapInRootShell(script) : script)
  }
