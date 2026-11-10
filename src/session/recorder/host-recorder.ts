import type { Result } from "ts-explicit-errors"

import type { CommandRecord } from "#session/recorder/commands.ts"
import type { StepRecord, StepRecorder } from "#session/recorder/step-recorder.ts"
import { createStepRecorder } from "#session/recorder/step-recorder.ts"
import type { Failure } from "#utils.ts"

/** How a host's preparation ended, when it didn't fail. */
type PreparationStatus = "prepared"

export interface HostRecord {
  name: string
  target: string
  preparation: PreparationRecord
  /** Every step that started, in the order the script called them. */
  stepRecords: StepRecord[]
  /** A step's or the host function's failure. A failed preparation keeps its own on `preparation`. */
  failure: Failure
}

/** What preflight did on the host before its script ran. */
interface PreparationRecord {
  /** Unset until preparation finishes, and an error if it failed. */
  status?: Result<PreparationStatus>
  commands: CommandRecord[]
  /** How to fix the preparation's failure, which the report shows under it. Empty unless it failed with a hint. */
  failureHints: string[]
}

export interface HostRecorder {
  hostRecord: HostRecord
  stepRecorder: StepRecorder
  /** Records how preparation ended, and any hints for its failure. */
  finishPreparation: (status: Result<PreparationStatus>, failureHints?: string[]) => void
}

/** Records one host's run, from preflight to the end of its host function, for the report to read. */
export const createHostRecorder = (name: string, target: string): HostRecorder => {
  const stepRecorder = createStepRecorder()

  const hostRecord: HostRecord = {
    name,
    target,
    preparation: { commands: [], failureHints: [] },
    stepRecords: stepRecorder.stepRecords,
    failure: undefined,
  }

  const finishPreparation = (status: Result<PreparationStatus>, failureHints: string[] = []) => {
    hostRecord.preparation.status = status
    hostRecord.preparation.failureHints = failureHints
  }

  return { hostRecord, stepRecorder, finishPreparation }
}
