import { toHostBlockEntries } from "#report/host-block/entries.ts"
import type { Verbosity } from "#report/verbosity.ts"
import type {
  EnsureComparisonValues,
  FileComparisonValues,
  HostRecord,
  LinkComparisonValues,
  RecordedUnownedFailure,
  StepKind,
  StepStatus,
} from "#session/session.ts"

/** The levels a piece of a block shows at: from `from`, up to `until` when it has one. The builder decides both. */
export interface PieceLevels {
  from: Verbosity
  until?: Verbosity
}

/** A host's block: its name, then its entries, or "no steps" for a script that made none and didn't fail. */
export type HostBlock = { name: string } & ({ kind: "entries"; entries: HostBlockEntry[] } | { kind: "noSteps" })

/**
 * One entry of a host block: a step, or the one failure no step owns. Its levels are where its own line shows, and it
 * also shows when a note part or a detail inside it shows.
 */
export interface HostBlockEntry extends PieceLevels {
  status: EntryStatus
  /** What the entry is about, which shows before the name. */
  kind: EntryKind
  name: EntryName
  /** The note's parts, which show after the name, joined with `, `. Empty when the entry has no note. */
  note: NotePart[]
  /** How a value would change, or for a failure, what the step last found on the host. */
  details: Detail[]
  /** Why the entry failed. */
  error?: Error
}

export type EntryStatus = StepStatus | "failed"

/** What a host block entry is about: a kind of step, or a failure no step owns. */
export type EntryKind = StepKind | UnownedFailureKind

/** Where a failure no step owns happened: in preparation, or in the host function, for `host fn`. */
type UnownedFailureKind = RecordedUnownedFailure["kind"]

/** A host block entry's name, and what kind of name it is, which decides how it's styled. */
export interface EntryName {
  text: string
  kind: NameKind
}

export type NameKind =
  // A name the script gave the step.
  | "step"
  // A name that's a value: a read's or an inspect's command, a file's or a link's path, or a target.
  | "value"

/** One part of an entry's note, like `needs 'A', 'B'`, the names of the steps a waiting step needs. */
export interface NotePart extends PieceLevels {
  kind: "needs"
  needs: string[]
}

/** One thing an entry shows under its status line, in the order they show, with the levels it shows at. */
export type Detail = PieceLevels
  // The options the script set that change how the step's commands ran, like `sudo`.
  & (
    | { kind: "options"; options: StepOption[] }
    | { kind: "diff"; got: string; want: string }
    // Holds everything about a file but a text diff, which is a detail of its own.
    | { kind: "fileComparisonValues"; values: FileComparisonValues }
    | { kind: "linkComparisonValues"; values: LinkComparisonValues }
    | { kind: "ensureComparisonValues"; values: EnsureComparisonValues }
    // The stderr of a command that can explain a failure that still differs after its fix.
    | { kind: "stderr"; command: string; stderr: string }
    // tsinfra's own aside about the details around it.
    | { kind: "note"; text: string }
    // Something that worked, but needs a look, like a link to a path where nothing exists.
    | { kind: "warning"; warning: StepWarning }
    // How to fix a failure, like setting the host's `sudo` option.
    | { kind: "hint"; text: string }
  )

/**
 * One option the script set on a step, like `sudo`, or one entry of an option, like a variable of `env`. Its name
 * always shows with the options detail. Its value is a piece of its own, which the filter leaves out below its level.
 */
export interface StepOption {
  name: string
  value?: OptionValue
  entries: StepOption[]
}

/** An option's value, with the levels it shows at. A secret value is masked. */
export interface OptionValue extends PieceLevels {
  value: string | boolean
}

/** Something that worked but needs a look, with the value it's about, like a path, when there is one. */
export interface StepWarning {
  text: string
  value?: string
}

/**
 * Returns a host's block, with every piece at every level, each with the level it shows from: an entry per finished
 * step, then the host's failure, if it failed. A host whose script made no steps and didn't fail gets "no steps"
 * instead, so it's clear the host ran.
 */
export const toHostBlock = (hostRecord: HostRecord): HostBlock => {
  const { name, stepRecords, failure } = hostRecord
  if (stepRecords.length === 0 && !failure) return { name, kind: "noSteps" }

  const entries = toHostBlockEntries(hostRecord)
  return { name, kind: "entries", entries }
}
