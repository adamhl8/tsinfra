import type { Result } from "ts-explicit-errors"

import type { StepOptionsRecord } from "#core/recorder/records/options.ts"
import type { ConvergePhase } from "#core/session/handlers/shared/converge.ts"
import type { ToolName, ToolOptions } from "#core/session/handlers/tools.ts"
import type { CommandOutput } from "#core/transport.ts"

export interface CommandRecord {
  cmd: string
  /** A short name for a command tsinfra wrote itself. Unset for a script's command. */
  label: string | undefined
  /** The tool call that ran the command. Unset for a step's own command and for tsinfra's. */
  toolCall: ToolCallRecord | undefined
  /** The part of `converge` that ran the command. Unset for a step that doesn't converge. */
  phase: ConvergePhase | undefined
  /** Unset until the command finishes. */
  output: Result<CommandOutput> | undefined
}

/** A tool call a step's function made: the tool the script called, and the options it set. */
export interface ToolCallRecord {
  toolName: ToolName
  /** The options the call set that the report shows, recorded like a step's. */
  options: ToolOptionsRecord
}

/** The options a tool call's record holds: each one as given, or its stand-in. */
type ToolOptionsRecord = Pick<StepOptionsRecord, keyof ToolOptions>
