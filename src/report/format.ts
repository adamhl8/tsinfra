import pc from "picocolors"
import prettyBytes from "pretty-bytes"
import { isErr, messageChain } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { HostReport } from "#hosts/run.ts"
import { hasDrift } from "#hosts/run.ts"
import { formatDiff } from "#report/diff.ts"
import type { Detail, NameKind, StepEntry } from "#report/entries.ts"
import { toStepEntries } from "#report/entries.ts"
import type { Style } from "#report/styles.ts"
import {
  STATUS_STYLES,
  styleError,
  styleGot,
  styleGotExitCode,
  styleGotString,
  styleNote,
  styleValue,
  styleWant,
  styleWantExitCode,
  styleWantString,
} from "#report/styles.ts"
import type { EnsureComparisonValues, Want } from "#session/handlers/ensure/check.ts"
import type { Bytes } from "#session/handlers/file/bytes.ts"
import type { ContentComparison, SizeComparison } from "#session/handlers/file/comparison/content.ts"
import { getMaxWidth, padToWidth, quoteNames } from "#utils.ts"

const INDENT = "  "
const DETAIL_INDENT = INDENT.repeat(3)
const COLUMN_GAP = "   "
const PLAN_REMINDER = "Steps after a change were checked without that change, so apply may differ."

export interface FormatOptions {
  /** Shows every step, even the ones that didn't change anything. */
  verbose?: boolean
}

/** One printed `label: value` row, with a multi-line value's later lines under its first. */
interface LabelRow {
  label: string
  valueLines: string[]
}

interface ValueKindRules {
  formatGot: (got: EnsureComparisonValues["got"]) => string
  formatWant: (want: Want) => string
}

const VALUE_KIND_RULES: Record<EnsureComparisonValues["kind"], ValueKindRules> = {
  string: {
    formatGot: (got) => styleGotString(String(got)),
    formatWant: (want) => styleWantString(String(want)),
  },
  boolean: {
    formatGot: (got) => styleGot(String(got)),
    formatWant: (want) => styleWant(String(want)),
  },
  exit: {
    formatGot: (got) => styleGotExitCode(`exit code ${String(got)}`),
    formatWant: (want) => styleWantExitCode(want === true ? "exit code 0" : "a non-zero exit code"),
  },
}

// Spell out a size in bytes, because a lone `B` reads like "billion".
const BYTE_UNIT = / B$/v

/** Formats a size like `15 bytes`, `1 byte`, or `2.05 kB`. */
const formatSize = (size: Bytes): string => prettyBytes(size).replace(BYTE_UNIT, size === 1 ? " byte" : " bytes")

// Give each note its words. The sizes follow every note, so they all read the same way.
const FILE_NOTE_WORDS: Record<SizeComparison["kind"], string> = {
  new: "new file",
  hidden: "hidden",
  binary: "binary",
  large: "too large to diff",
}

// Style a value name, because it's a command, a path, or a target, and a host script in italics, because it isn't a step.
const NAME_STYLES: Record<NameKind, Style> = {
  step: (name) => name,
  value: styleValue,
  hostScript: pc.italic,
}

/** Reports whether a file's content compared only by size, which shows as a note in place of a diff. */
const isSizeComparison = (content: ContentComparison): content is SizeComparison =>
  content.kind !== "same" && content.kind !== "text"

/** Formats a note in place of a diff, like `binary, 12 kB -> 14 kB`, or `new file, 2 kB` when there's no file yet. */
const formatFileNote = (sizeComparison: SizeComparison): string => {
  const { kind, gotSize, wantSize } = sizeComparison
  // Color the sizes like `got` and `want`, because they're the change, like an attribute's values.
  const wantText = styleWant(formatSize(wantSize))
  const sizes = gotSize === undefined ? wantText : `${styleGot(formatSize(gotSize))} -> ${wantText}`
  // Italicize the words, because they describe the content rather than show a value.
  return `${pc.italic(FILE_NOTE_WORDS[kind])}, ${sizes}`
}

/** Returns the `label: value` rows a detail prints as. A diff has none, because it prints as lines of its own. */
const toLabelRows = (detail: Detail): LabelRow[] => {
  if (detail.kind === "diff") return []

  if (detail.kind === "ensureComparisonValues") {
    const { values } = detail
    const { formatGot, formatWant } = VALUE_KIND_RULES[values.kind]
    return [
      { label: "got", valueLines: [formatGot(values.got)] },
      { label: "want", valueLines: [formatWant(values.want)] },
    ]
  }

  if (detail.kind === "fileComparisonValues") {
    const { content, attributes } = detail.values
    // Show a note for content the output can't diff, because a text diff prints as its own detail.
    const contentRows = isSizeComparison(content) ? [{ label: "content", valueLines: [formatFileNote(content)] }] : []
    const attributeRows = attributes.map(({ name, got, want }) => ({
      label: name,
      valueLines: [`${styleGot(got)} -> ${styleWant(want)}`],
    }))
    return [...contentRows, ...attributeRows]
  }

  // Style each line of stderr, so a continuation line starts in the value's color too.
  return [{ label: "stderr", valueLines: detail.stderr.split("\n").map((stderrLine) => styleValue(stderrLine)) }]
}

/** Formats rows as `label: value` lines, with each value starting at `valueColumn`. */
const formatLabelRows = (labelRows: LabelRow[], valueColumn: number): string[] => {
  const continuationIndent = " ".repeat(valueColumn)

  return labelRows.flatMap(({ label, valueLines }) => {
    // Dim the label, so the value is what stands out.
    const labelText = pc.dim(padToWidth(`${label}: `, valueColumn))
    return valueLines.map((valueLine, index) => `${index === 0 ? labelText : continuationIndent}${valueLine}`)
  })
}

/**
 * Formats the lines under an entry's head line: its error in red, if any, then its details. Lines up the values of
 * every `label: value` row in the entry in one column. Indents the details under an error, so an error stands apart and
 * its details read as belonging to it.
 */
const formatEntryBody = (stepEntry: StepEntry, formatOptions: FormatOptions): string[] => {
  const { error, details = [] } = stepEntry
  const labels = details.flatMap((detail) => toLabelRows(detail)).map(({ label }) => `${label}: `)
  const valueColumn = getMaxWidth(labels)

  const detailLines = details.flatMap((detail) =>
    detail.kind === "diff"
      ? formatDiff(detail.got, detail.want, formatOptions)
      : formatLabelRows(toLabelRows(detail), valueColumn),
  )
  if (!error) return detailLines

  const errorLines = messageChain(error)
    .split("\n")
    .map((errorLine) => styleError(errorLine))
  return [...errorLines, ...detailLines.map((detailLine) => `${INDENT}${detailLine}`)]
}

/** Formats a waiting step's step note, like `needs 'A', 'B'`. */
const formatNeedsNote = (needs: string[]): string => `needs ${quoteNames(needs)}`

const formatStepEntries = (stepEntries: StepEntry[], formatOptions: FormatOptions): string[] => {
  // Line up every step note in a block in one column, past the longest name that has one.
  const stepNoteColumn = getMaxWidth(stepEntries.filter(({ needs }) => needs).map(({ name }) => name.text))

  return stepEntries.flatMap((stepEntry) => {
    const { status, name, needs } = stepEntry
    const { color, symbol } = STATUS_STYLES[status]
    const stepNote = needs ? formatNeedsNote(needs) : undefined

    const styledName = NAME_STYLES[name.kind](name.text)
    const nameText = stepNote ? padToWidth(styledName, stepNoteColumn) : styledName
    // Dim a step note, so the step's name stays the main thing on the line.
    const stepNoteText = stepNote ? `${COLUMN_GAP}${pc.dim(stepNote)}` : ""
    const headLine = `${INDENT}${color(symbol)} ${nameText}${stepNoteText}`
    const bodyLines = formatEntryBody(stepEntry, formatOptions).map((bodyLine) => `${DETAIL_INDENT}${bodyLine}`)

    return [headLine, ...bodyLines]
  })
}

/**
 * Formats a host's block: its name, then an entry for each step that changed, ran, waits, or failed. With `verbose`,
 * every step gets an entry, and a host with no steps still gets a block, so it's clear the host ran.
 */
export const formatHostBlock = (hostReport: HostReport, formatOptions: FormatOptions = {}): string | undefined => {
  const { name } = hostReport
  const { verbose = false } = formatOptions
  const stepEntries = toStepEntries(hostReport, formatOptions)

  if (stepEntries.length === 0 && verbose) return [pc.bold(name), `${INDENT}${styleNote("no steps")}`].join("\n")
  if (stepEntries.length === 0) return

  return [pc.bold(name), ...formatStepEntries(stepEntries, formatOptions)].join("\n")
}

const formatHostStatus = (hostReport: HostReport): string => {
  if (!hostReport.started || hostReport.failure) return STATUS_STYLES.failed.color("failed")

  const { stepRecords } = hostReport

  const statuses = stepRecords.map(({ outcome }) => (isErr(outcome) ? undefined : outcome?.status))
  // Count `ran` steps too, so the count matches the `~` and `>` lines in the block.
  const changeCount = statuses.filter((status) => status === "changed" || status === "ran").length
  const waitingCount = statuses.filter((status) => status === "waiting").length
  if (changeCount === 0 && waitingCount === 0) return STATUS_STYLES.unchanged.color("unchanged")

  // Color each count like its symbol, and leave the comma between them uncolored.
  const counts: string[] = []
  if (changeCount > 0)
    counts.push(STATUS_STYLES.changed.color(`${changeCount} ${changeCount === 1 ? "change" : "changes"}`))
  if (waitingCount > 0) counts.push(STATUS_STYLES.waiting.color(`${waitingCount} waiting`))
  return counts.join(", ")
}

/** Formats one line per host, with the plan reminder first when anything would change. */
export const formatSummary = (hostReports: HostReport[], mode: Mode): string => {
  const nameWidth = getMaxWidth(hostReports.map(({ name }) => name))
  const hostLines = hostReports.map(
    (hostReport) => `${padToWidth(hostReport.name, nameWidth)}${COLUMN_GAP}${formatHostStatus(hostReport)}`,
  )

  const hasAnyDrift = mode === "plan" && hostReports.some((hostReport) => hasDrift(hostReport))
  // Dim the reminder, so the host lines stay the main thing in the summary.
  return [...(hasAnyDrift ? [pc.dim(PLAN_REMINDER), ""] : []), ...hostLines].join("\n")
}
