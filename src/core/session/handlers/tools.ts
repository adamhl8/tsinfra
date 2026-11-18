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

/** A tool's command and options, once validated. */
export interface ToolCall {
  cmd: string
  options: ToolOptions
}

/** Validates the command and options the script gave a tool. */
export const validateToolCall = (toolName: ToolName, cmd: unknown, options: unknown): Result<ToolCall> => {
  const validCmd = validateInput(cmd, nonEmptyStringSchema, { inputLabel: "command", givenTo: toolName })
  if (isErr(validCmd)) return validCmd

  const validOptions = validateInput(options, toolOptionsSchema, { inputLabel: "options", givenTo: toolName })
  if (isErr(validOptions)) return validOptions

  return { cmd: validCmd, options: validOptions }
}

/** Returns the options the shell runs a tool call's command with, which reads its input into bytes. */
const toCommandOptions = async (toolName: ToolName, toolCall: ToolCall): Promise<Result<CommandOptions>> => {
  const { input, ...otherOptions } = toolCall.options
  if (input === undefined) return otherOptions

  const inputBytes = await readContentBytes(input, "the input")
  if (isErr(inputBytes)) return err(toToolFailureMessage(toolName, toolCall.cmd), inputBytes)

  return { input: inputBytes, ...otherOptions }
}

/** Runs a validated command for `read` or `exec` and returns its stdout, trimmed. A non-zero exit is an error. */
export const runExecCommand = async (ctx: ToolContext, toolCall: ToolCall): Promise<Result<string>> => {
  const { toolName, shell } = ctx

  const commandOptions = await toCommandOptions(toolName, toolCall)
  if (isErr(commandOptions)) return commandOptions

  const stdout = await shell.exec(toolCall.cmd, commandOptions)
  if (isErr(stdout)) return err(toToolFailureMessage(toolName, toolCall.cmd), stdout)

  return stdout.trim()
}

/** Runs a validated command for `inspect` and returns its output and exit code. A non-zero exit is an answer. */
export const runInspectCommand = async (ctx: ToolContext, toolCall: ToolCall): Promise<Result<InspectResult>> => {
  const { toolName, shell } = ctx

  const commandOptions = await toCommandOptions(toolName, toolCall)
  if (isErr(commandOptions)) return commandOptions

  const commandOutput = await shell.inspect(toolCall.cmd, commandOptions)
  if (isErr(commandOutput)) return err(toToolFailureMessage(toolName, toolCall.cmd), commandOutput)

  const { stdout, stderr, exitCode } = commandOutput
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

/** Runs one command for `read` or `exec` and returns its stdout, trimmed. A non-zero exit is an error. */
export const execCommand = async (ctx: ToolContext, cmd: unknown, options: unknown = {}): Promise<Result<string>> => {
  const toolCall = validateToolCall(ctx.toolName, cmd, options)
  if (isErr(toolCall)) return toolCall

  return runExecCommand(ctx, toolCall)
}

/** Runs one command for `inspect` and returns its output and exit code. A non-zero exit is an answer, not an error. */
export const inspectCommand = async (
  ctx: ToolContext,
  cmd: unknown,
  options: unknown = {},
): Promise<Result<InspectResult>> => {
  const toolCall = validateToolCall(ctx.toolName, cmd, options)
  if (isErr(toolCall)) return toolCall

  return runInspectCommand(ctx, toolCall)
}
