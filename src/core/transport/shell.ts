import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { Content } from "#core/content.ts"
import { readContentBytes } from "#core/content/read.ts"
import type { CommandOutput, Transport } from "#core/transport.ts"
import { addEnvPrelude, wrapCommandWithInput, wrapInRootShell } from "#core/transport/utils.ts"
import { createCommandExitError } from "#utils.ts"

/** A command a shell is about to run, as its record shows it, with a label when tsinfra wrote the command itself. */
interface ShellCommand {
  cmd: string
  label: string | undefined
}

/** Records a command's output once it finishes, and masks it from then on when `maskOutput` is set. */
export type RecordOutput = (output: Result<CommandOutput>, maskOutput: boolean) => void

/** Records each command a shell runs. Each recorder passes its own, which decides where the records go. */
export interface CommandRecorder {
  /** Records a command before it runs, and returns what records its output once it finishes. */
  recordCommand: (shellCommand: ShellCommand) => RecordOutput
}

/** What a shell is bound to when it's created, and uses for every command it runs. */
export interface ShellOptions {
  /** Runs each command as root, in a `sudo sh -s`. */
  sudo?: boolean
  /** Variables exported before each command. */
  variables?: Record<string, string>
  /** Records each command and its output. A shell without one records nothing. */
  commandRecorder?: CommandRecorder
}

/** What one call of `exec` or `inspect` takes, for that command only. */
interface ShellCallOptions {
  /** A short name for a command tsinfra wrote itself. */
  label?: string
  /** The text to record in place of the command, for one that holds content. */
  recordedCmd?: string
  /** The data the command reads on its stdin, which the record never holds. A tool's validated `input` can be unset. */
  input?: Content | undefined
  /** Whether the command's output is a secret, which the record masks from this command on. */
  maskOutput?: boolean
}

export interface Shell {
  /** Runs `cmd` and returns its output untouched. Only failing to run at all is an error. */
  inspect: (cmd: string, options?: ShellCallOptions) => Promise<Result<CommandOutput>>
  /** Runs `cmd` and returns its stdout. Failing to run and a non-zero exit are both errors. */
  exec: (cmd: string, options?: ShellCallOptions) => Promise<Result<string>>
}

/**
 * Returns a shell that runs each command on `transport` with what `shellOptions` binds it to, and records each one when
 * it has a command recorder. `exec` and `inspect` take only what's for one command.
 */
export const createShell = (transport: Transport, shellOptions: ShellOptions = {}): Shell => {
  const { sudo = false, variables = {}, commandRecorder } = shellOptions

  /** Runs `cmd` the way `shellOptions` binds it to, with `options` for this command, recording it when it can. */
  const runCommand = async (cmd: string, options: ShellCallOptions): Promise<Result<CommandOutput>> => {
    const { label, recordedCmd = cmd, input, maskOutput = false } = options
    const inputBytes = input === undefined ? undefined : await readContentBytes(input, "the input")
    if (isErr(inputBytes)) return inputBytes

    // Record the command before the input, the prelude, and the root shell wrap it, so the record holds the script's
    // own command. Record it before it runs, so commands run at once keep the order they were called in.
    const recordOutput = commandRecorder?.recordCommand({ cmd: recordedCmd, label })
    const cmdWithInput = inputBytes === undefined ? cmd : wrapCommandWithInput(cmd, inputBytes)
    // Add the prelude before the root shell wraps the command, so the variables are set inside the root shell, and
    // sudo's reset of the environment can't drop them.
    const scriptWithEnv = addEnvPrelude(cmdWithInput, variables)
    const script = sudo ? wrapInRootShell(scriptWithEnv) : scriptWithEnv
    const output = await transport(script)
    recordOutput?.(output, maskOutput)
    return output
  }

  const inspect = async (cmd: string, options: ShellCallOptions = {}): Promise<Result<CommandOutput>> =>
    runCommand(cmd, options)

  const exec = async (cmd: string, options: ShellCallOptions = {}): Promise<Result<string>> => {
    const output = await runCommand(cmd, options)
    if (isErr(output)) return output
    if (output.exitCode !== 0) return createCommandExitError(output)

    return output.stdout
  }

  return { inspect, exec }
}
