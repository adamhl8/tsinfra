import type { FinishedStepRecord, StepRecord } from "#core/session/recorder/records.ts"
import type { StepKind, StepStatus } from "#core/session/step.ts"
import type { Mode } from "#mode.ts"
import type { EntryName, FinishedStepEntry, NameKind } from "#report/host-block.ts"
import { toStepDetails } from "#report/host-block/details.ts"
import { toStepNote } from "#report/host-block/note.ts"
import type { Verbosity } from "#report/verbosity.ts"

// Show a step that was already right, or only looked, from level 1, because it changed nothing on the host.
// Show a `resume` step from level 0, because it's rare, and it explains the follow-ups it triggers.
// Leave the mode out, because `getEntryLevel` moves a `ranAlways` run to level 1 in `plan`.
const ENTRY_LEVELS: Record<StepStatus, Verbosity> = {
  unchanged: 1,
  observed: 1,
  changed: 0,
  ran: 0,
  ranAlways: 0,
  ranFromOpenChanges: 0,
  waiting: 0,
  resume: 0,
}

// Treat a read's or an inspect's name as a value, because it's the command itself, and a file's, a link's, or a
// directory's, because it's a path.
const STEP_NAME_KINDS: Record<StepKind, NameKind> = {
  read: "value",
  inspect: "value",
  file: "value",
  link: "value",
  dir: "value",
  ensure: "step",
  run: "step",
}

/**
 * Returns the level a step's entry shows from. A `ranAlways` run shows from level 1 in `plan`, because it runs on every
 * apply, so the plan has nothing new to say about it.
 */
const getEntryLevel = (status: StepStatus, mode: Mode): Verbosity =>
  mode === "plan" && status === "ranAlways" ? 1 : ENTRY_LEVELS[status]

/** Returns a step's name with the kind of name it is, which decides how it's styled. */
export const toStepName = ({ name, kind }: StepRecord): EntryName => ({ text: name, kind: STEP_NAME_KINDS[kind] })

/** Returns the entry of a step that finished. */
export const toStepEntry = (stepRecord: FinishedStepRecord, mode: Mode): FinishedStepEntry => {
  const { status, kind } = stepRecord

  const name = toStepName(stepRecord)
  const note = toStepNote(stepRecord)
  const details = toStepDetails(stepRecord)
  const from = getEntryLevel(status, mode)

  return { status, kind, name, note, details, from }
}
