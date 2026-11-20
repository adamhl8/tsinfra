import process from "node:process"
import readline from "node:readline"

import { sliceAnsi } from "bun"

import type { HostRecord, StepRecord } from "#core/session/recorder/records.ts"
import type { Mode } from "#mode.ts"
import { entryNameElement, kindElement } from "#report/format/elements/entry.ts"
import { toStepName } from "#report/host-block/entries.ts"
import { styleMuted, styleValue } from "#styles.ts"
import { countOf } from "#utils.ts"

const MODE_VERBS: Record<Mode, string> = { plan: "Planning", apply: "Applying" }
const PROGRESS_POLL_MS = 100

/** Formats the progress line shown while every host is prepared. */
export const formatPreparingProgress = (hostCount: number): string =>
  styleMuted(`Preparing ${countOf(hostCount, "host", "hosts")}...`)

/**
 * Formats the progress line shown while the host `name` runs, with its name in the value color like the sudo prompt.
 * Adds the running step's kind and name the way the report shows them, with only the name's first line.
 */
const formatHostProgress = (name: string, mode: Mode, runningStep: StepRecord | undefined): string => {
  const hostProgress = `${styleMuted(`${MODE_VERBS[mode]} host '`)}${styleValue(name)}${styleMuted("'")}`
  if (!runningStep) return `${hostProgress}${styleMuted("...")}`

  const stepName = toStepName(runningStep)
  const firstLine = stepName.text.split("\n", 1)[0] ?? ""
  const stepProgress = `${kindElement(runningStep.kind)} ${entryNameElement({ ...stepName, text: firstLine })}`
  return `${hostProgress} ${styleMuted("·")} ${stepProgress}${styleMuted("...")}`
}

/**
 * Prints `progress` on stderr with no newline, so `clearProgress` can erase it. Prints nothing when stderr isn't a
 * terminal, so a log or a pipe gets only the report.
 */
export const printProgress = (progress: string) => {
  if (!process.stderr.isTTY) return
  // Cut the line one column short of the terminal's width, because a line that wraps leaves rows `clearProgress` can't
  // reach.
  const { columns } = process.stderr
  process.stderr.write(sliceAnsi(progress, 0, columns - 1, "…"))
}

/** Erases the progress line, so what prints next starts at the beginning of an empty line. */
export const clearProgress = () => {
  if (!process.stderr.isTTY) return
  readline.clearLine(process.stderr, 0)
  readline.cursorTo(process.stderr, 0)
}

/**
 * Shows the progress line for the host whose record is `hostRecord`, and redraws it each time a new step starts.
 * Returns a function that stops it and erases the line.
 */
export const showHostProgress = (hostRecord: HostRecord, mode: Mode): (() => void) => {
  if (!process.stderr.isTTY) {
    return () => {
      /* empty */
    }
  }

  let shownStep: StepRecord | undefined
  printProgress(formatHostProgress(hostRecord.name, mode, shownStep))

  // Read the running step on a timer, because the session pushes each step's record onto `hostRecord` when it starts.
  // Keep the last step shown between steps, so the line doesn't flicker back to the host alone.
  const poll = setInterval(() => {
    const { runningStep } = hostRecord
    if (!runningStep || runningStep === shownStep) return
    shownStep = runningStep
    clearProgress()
    printProgress(formatHostProgress(hostRecord.name, mode, shownStep))
  }, PROGRESS_POLL_MS)

  return () => {
    clearInterval(poll)
    clearProgress()
  }
}
