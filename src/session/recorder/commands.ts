import type { Result } from "ts-explicit-errors"

import type { CommandOutput } from "#transport/transport.ts"

/** The parts of `converge` that run commands, in order. */
export type ConvergePhase = "before" | "fix" | "after"

export interface CommandRecord {
  cmd: string
  /** A short name for a command tsinfra wrote itself. Unset for a script's command. */
  label?: string
  /** The part of `converge` that ran the command. Unset for a step that doesn't converge. */
  phase?: ConvergePhase
  /** Unset until the command finishes. */
  output?: Result<CommandOutput>
}
