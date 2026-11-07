import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { validateInput } from "#session/handlers/shared/validate-input.ts"
import type { Shell } from "#session/shell.ts"
import { nonEmptyStringSchema } from "#session/step.ts"

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

/** Runs one command on the host and returns its stdout, trimmed. A non-zero exit throws. */
export type Exec = (cmd: string) => Promise<string>

/** Runs one command on the host and returns its output and exit code. A non-zero exit is an answer, not a failure. */
export type Inspect = (cmd: string) => Promise<InspectResult>

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

/** Runs one command for `read` or `exec` and returns its stdout, trimmed. A non-zero exit is an error. */
export const execCommand = async (ctx: ToolContext, cmd: unknown): Promise<Result<string>> => {
  const { toolName, shell } = ctx

  const validCmd = validateInput(cmd, nonEmptyStringSchema, { inputLabel: "command", givenTo: toolName })
  if (isErr(validCmd)) return validCmd

  const stdout = await shell.exec(validCmd)
  if (isErr(stdout)) return err(`failed to ${TOOL_VERBS[toolName]} '${validCmd}'`, stdout)

  return stdout.trim()
}

/** Runs one command for `inspect` and returns its output and exit code. A non-zero exit is an answer, not an error. */
export const inspectCommand = async (ctx: ToolContext, cmd: unknown): Promise<Result<InspectResult>> => {
  const { toolName, shell } = ctx

  const validCmd = validateInput(cmd, nonEmptyStringSchema, { inputLabel: "command", givenTo: toolName })
  if (isErr(validCmd)) return validCmd

  const commandOutput = await shell.inspect(validCmd)
  if (isErr(commandOutput)) return err(`failed to ${TOOL_VERBS[toolName]} '${validCmd}'`, commandOutput)

  const { stdout, stderr, exitCode } = commandOutput
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}
