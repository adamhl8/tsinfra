import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { InputOptions, MaskOptions } from "#core/session/handlers/options/handler.ts"
import { inputOptionsSchema, maskOptionsSchema } from "#core/session/handlers/options/handler.ts"
import { readContentBytes } from "#core/session/handlers/shared/content.ts"
import { validateInput } from "#core/session/handlers/shared/validate-input.ts"
import { nonEmptyStringSchema } from "#core/session/step.ts"
import type { CommandOptions, Shell } from "#core/transport/shell.ts"

/** Tools that only read the host. A check function gets these, because it also runs during `plan`. */
export interface ReadTools {
  /** Reads from the host. Its command must not change what the script manages, because it also runs during `plan`. */
  read: Exec
  inspect: Inspect
}

/** Tools that can change the host. A fix or run function gets these. */
export interface ChangeTools {
  /** Runs a command that changes the host. */
  exec: Exec
  inspect: Inspect
}

/** The options every tool takes. */
export interface ToolOptions extends InputOptions, MaskOptions {}

const toolOptionsSchema = inputOptionsSchema.merge(maskOptionsSchema)

/** Runs one command on the host and returns its stdout, trimmed. A non-zero exit throws. */
export type Exec = (cmd: string, options?: ToolOptions) => Promise<string>

/** Runs one command on the host and returns its output and exit code. A non-zero exit is an answer, not a failure. */
export type Inspect = (cmd: string, options?: ToolOptions) => Promise<InspectResult>

/** What `inspect` gives a script: a command's stdout and stderr, both trimmed, and its exit code. */
export interface InspectResult {
  stdout: string
  stderr: string
  exitCode: number
}

export type ToolName = keyof ReadTools | keyof ChangeTools

/** What a tool is given: the name the script called it by, and the session's shell. */
export interface ToolContext {
  toolName: ToolName
  shell: Shell
}

// Name the action in a failure, because a command given to `read` was read, not run.
const TOOL_VERBS: Record<ToolName, string> = {
  read: "read",
  inspect: "inspect",
  exec: "run",
}

/** Returns what a tool's failure says, naming the command. */
const toToolFailureMessage = (toolName: ToolName, cmd: string) => `failed to ${TOOL_VERBS[toolName]} '${cmd}'`

/** A tool's command and the options the shell runs it with, once its input is read. */
interface ResolvedToolCommand {
  cmd: string
  commandOptions: CommandOptions
}

/** Validates the command and options the script gave a tool, and reads its input into bytes. */
const resolveToolCommand = async (
  toolName: ToolName,
  cmd: unknown,
  options: unknown,
): Promise<Result<ResolvedToolCommand>> => {
  const validCmd = validateInput(cmd, nonEmptyStringSchema, { inputLabel: "command", givenTo: toolName })
  if (isErr(validCmd)) return validCmd

  const validOptions = validateInput(options, toolOptionsSchema, { inputLabel: "options", givenTo: toolName })
  if (isErr(validOptions)) return validOptions

  const { input, ...otherOptions } = validOptions
  if (input === undefined) return { cmd: validCmd, commandOptions: otherOptions }

  const inputBytes = await readContentBytes(input, "the input")
  if (isErr(inputBytes)) return err(toToolFailureMessage(toolName, validCmd), inputBytes)

  return { cmd: validCmd, commandOptions: { input: inputBytes, ...otherOptions } }
}

/** Runs one command for `read` or `exec` and returns its stdout, trimmed. A non-zero exit is an error. */
export const execCommand = async (ctx: ToolContext, cmd: unknown, options: unknown = {}): Promise<Result<string>> => {
  const { toolName, shell } = ctx

  const toolCommand = await resolveToolCommand(toolName, cmd, options)
  if (isErr(toolCommand)) return toolCommand

  const stdout = await shell.exec(toolCommand.cmd, toolCommand.commandOptions)
  if (isErr(stdout)) return err(toToolFailureMessage(toolName, toolCommand.cmd), stdout)

  return stdout.trim()
}

/** Runs one command for `inspect` and returns its output and exit code. A non-zero exit is an answer, not an error. */
export const inspectCommand = async (
  ctx: ToolContext,
  cmd: unknown,
  options: unknown = {},
): Promise<Result<InspectResult>> => {
  const { toolName, shell } = ctx

  const toolCommand = await resolveToolCommand(toolName, cmd, options)
  if (isErr(toolCommand)) return toolCommand

  const commandOutput = await shell.inspect(toolCommand.cmd, toolCommand.commandOptions)
  if (isErr(commandOutput)) return err(toToolFailureMessage(toolName, toolCommand.cmd), commandOutput)

  const { stdout, stderr, exitCode } = commandOutput
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}
