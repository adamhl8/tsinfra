import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Shell } from "#session/shell.ts"
import { nonEmptyStringSchema } from "#session/step.ts"

/** What `inspect` gives a script: a command's stdout and stderr, both trimmed, and its exit code. */
export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Runs one command on the host and returns its stdout, trimmed. A non-zero exit throws. */
export type Exec = (cmd: string) => Promise<string>

/** Runs one command on the host and returns its output and exit code. A non-zero exit is an answer, not a failure. */
export type Inspect = (cmd: string) => Promise<CommandResult>

type ToolName = "read" | "inspect" | "exec"

/** What a command function is given: the name the script called it by, and the session's shell. */
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

/** Runs one command for `read` or `exec` and returns its stdout, trimmed. A non-zero exit is an error. */
export const execCommand = async (ctx: ToolContext, cmd: unknown): Promise<Result<string>> => {
  const { toolName, shell } = ctx

  const validCmd = nonEmptyStringSchema(cmd)
  if (validCmd instanceof type.errors)
    return err(`failed to validate the command given to '${toolName}'`, err(validCmd.summary, undefined))

  const stdout = await shell.run(validCmd)
  if (isErr(stdout)) return err(`failed to ${TOOL_VERBS[toolName]} '${validCmd}'`, stdout)

  return stdout.trim()
}

/** Runs one command for `inspect` and returns its output and exit code. A non-zero exit is an answer, not an error. */
export const inspectCommand = async (ctx: ToolContext, cmd: unknown): Promise<Result<CommandResult>> => {
  const { toolName, shell } = ctx

  const validCmd = nonEmptyStringSchema(cmd)
  if (validCmd instanceof type.errors)
    return err(`failed to validate the command given to '${toolName}'`, err(validCmd.summary, undefined))

  const commandOutput = await shell.inspect(validCmd)
  if (isErr(commandOutput)) return err(`failed to ${TOOL_VERBS[toolName]} '${validCmd}'`, commandOutput)

  const { stdout, stderr, exitCode } = commandOutput
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

/** What a check function is given. It also runs during `plan`, so it gets no tool that changes the host. */
export interface CheckTools {
  /** Reads from the host. Its command must not change what the script manages, because it also runs during `plan`. */
  read: Exec
  inspect: Inspect
}

/** What a fix or run function is given. */
export interface ChangeTools {
  /** Runs a command that changes the host. */
  exec: Exec
  inspect: Inspect
}
