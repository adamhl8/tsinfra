import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { EnvOptions, InputOptions, MaskOptions } from "#core/session/handlers/options/command.ts"
import { envOptionsSchema, inputOptionsSchema, maskOptionsSchema } from "#core/session/handlers/options/command.ts"
import { validateInput } from "#core/session/handlers/shared/validate-input.ts"
import { nonEmptyStringSchema } from "#core/session/step.ts"
import type { Shell } from "#core/transport/shell.ts"

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
export interface ToolOptions extends EnvOptions, InputOptions, MaskOptions {}

// Set the defaults in a pipe, because ArkType only allows a default on a required key.
// Keep `input` as it was given, because no content stands in for none.
const toolOptionsSchema = type
  .declare<ToolOptions>()
  .type(envOptionsSchema.and(inputOptionsSchema).and(maskOptionsSchema))
  .pipe(({ env = {}, secretEnv = {}, input, maskOutput = false }) => ({ env, secretEnv, input, maskOutput }))

/** A tool's options after validation, with their defaults set. */
export type ValidToolOptions = typeof toolOptionsSchema.infer

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

/** Returns a shell for one tool call, which records the call on its command. */
export type GetToolShell = (toolName: ToolName, toolOptions: ValidToolOptions) => Shell

/** What runs one validated command: the name the script called the tool or step by, and the shell to run it on. */
interface CommandContext {
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
  options: ValidToolOptions
}

/** Validates the command and options the script gave a tool. */
export const validateToolCall = (toolName: ToolName, cmd: unknown, options: unknown): Result<ToolCall> => {
  const validCmd = validateInput(cmd, nonEmptyStringSchema, { inputLabel: "command", givenTo: toolName })
  if (isErr(validCmd)) return validCmd

  const validOptions = validateInput(options, toolOptionsSchema, { inputLabel: "options", givenTo: toolName })
  if (isErr(validOptions)) return validOptions

  return { cmd: validCmd, options: validOptions }
}

/**
 * Runs a validated command for `read` or `exec` and returns its stdout, trimmed. A non-zero exit is an error. Passes
 * only `input` and `maskOutput` with the command, because its shell is already bound to the call's variables.
 */
export const runExecCommand = async (ctx: CommandContext, toolCall: ToolCall): Promise<Result<string>> => {
  const { toolName, shell } = ctx
  const { input, maskOutput } = toolCall.options

  const stdout = await shell.exec(toolCall.cmd, { input, maskOutput })
  if (isErr(stdout)) return err(toToolFailureMessage(toolName, toolCall.cmd), stdout)

  return stdout.trim()
}

/**
 * Runs a validated command for `inspect` and returns its output and exit code. A non-zero exit is an answer. Passes
 * only `input` and `maskOutput` with the command, because its shell is already bound to the call's variables.
 */
export const runInspectCommand = async (ctx: CommandContext, toolCall: ToolCall): Promise<Result<InspectResult>> => {
  const { toolName, shell } = ctx
  const { input, maskOutput } = toolCall.options

  const commandOutput = await shell.inspect(toolCall.cmd, { input, maskOutput })
  if (isErr(commandOutput)) return err(toToolFailureMessage(toolName, toolCall.cmd), commandOutput)

  const { stdout, stderr, exitCode } = commandOutput
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

/** What a tool is given: the name the script called it by, and where to get a shell for each call. */
export interface ToolContext {
  toolName: ToolName
  getToolShell: GetToolShell
}

/** Runs one command for `read` or `exec` and returns its stdout, trimmed. A non-zero exit is an error. */
export const execCommand = async (ctx: ToolContext, cmd: unknown, options: unknown = {}): Promise<Result<string>> => {
  const { toolName, getToolShell } = ctx

  const toolCall = validateToolCall(toolName, cmd, options)
  if (isErr(toolCall)) return toolCall

  const shell = getToolShell(toolName, toolCall.options)
  return runExecCommand({ toolName, shell }, toolCall)
}

/** Runs one command for `inspect` and returns its output and exit code. A non-zero exit is an answer, not an error. */
export const inspectCommand = async (
  ctx: ToolContext,
  cmd: unknown,
  options: unknown = {},
): Promise<Result<InspectResult>> => {
  const { toolName, getToolShell } = ctx

  const toolCall = validateToolCall(toolName, cmd, options)
  if (isErr(toolCall)) return toolCall

  const shell = getToolShell(toolName, toolCall.options)
  return runInspectCommand({ toolName, shell }, toolCall)
}
