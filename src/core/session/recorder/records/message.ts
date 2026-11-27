import type { MessageKind } from "#core/session/handlers/log.ts"
import type { ConvergePhase } from "#core/session/handlers/shared/converge.ts"

/** A host message: one the script logged outside a step, which the report shows between the steps around it. */
export interface HostMessageRecord extends BaseMessageRecord {
  kind: "hostMessage"
}

/** A step message: one a step's function logged. */
export interface StepMessageRecord extends BaseMessageRecord {
  /** The part of `converge` that was running. Unset for a step that doesn't converge. */
  phase: ConvergePhase | undefined
  /** How many of the step's commands were recorded when it was logged, which places it among them. */
  commandCount: number
}

/** A message the script logged with `h.log`: a host message or a step message. */
interface BaseMessageRecord {
  messageKind: MessageKind
  text: string
}
