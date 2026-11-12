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

/** A host's block: its name, then its entries, or "no steps" for a script that made none and didn't fail. */
export type HostBlock = { name: string } & ({ kind: "entries"; entries: HostBlockEntry[] } | { kind: "noSteps" })

/** One entry of a host block: a step, or the one failure no step owns. */
export interface HostBlockEntry {
  status: EntryStatus
  /** What the entry is about, which shows before the name. */
  kind: EntryKind
  name: EntryName
  /** The step's options worth showing, like `sudo`, which show after the name. Empty when there are none. */
  options: EntryOption[]
  /** The note's parts, which show after the options, joined with `, `. Empty when the entry has no note. */
  note: NotePart[]
  /** How a value would change, or for a failure, what the step last found on the host. */
  details: Detail[]
  /** The lowest level the entry shows at, unless a note part or a detail inside it shows. The builder decides it. */
  from: Verbosity
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

/** An option the script gave the step that changes how it ran, like `sudo`, which ran every command as root. */
export interface EntryOption {
  kind: "sudo"
  /** The lowest level the option shows at. The builder decides it. */
  from: Verbosity
}

/** One part of an entry's note, like `needs 'A', 'B'`, the names of the steps a waiting step needs. */
export interface NotePart {
  kind: "needs"
  needs: string[]
  /** The lowest level the part shows at. The builder decides it. */
  from: Verbosity
}

/**
 * One thing an entry shows under its status line. Its `from` is the lowest level it shows at, which the builder
 * decides.
 */
export type Detail =
  | { kind: "diff"; got: string; want: string; from: Verbosity }
  // Holds everything about a file but a text diff, which is a detail of its own.
  | { kind: "fileComparisonValues"; values: FileComparisonValues; from: Verbosity }
  | { kind: "linkComparisonValues"; values: LinkComparisonValues; from: Verbosity }
  | { kind: "ensureComparisonValues"; values: EnsureComparisonValues; from: Verbosity }
  // The stderr of a command that can explain a failure that still differs after its fix.
  | { kind: "stderr"; command: string; stderr: string; from: Verbosity }
  // tsinfra's own aside about the details around it.
  | { kind: "note"; text: string; from: Verbosity }
  // Something that worked, but needs a look, like a link to a path where nothing exists.
  | { kind: "warning"; warning: StepWarning; from: Verbosity }
  // How to fix a failure, like setting the host's `sudo` option.
  | { kind: "hint"; text: string; from: Verbosity }

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
