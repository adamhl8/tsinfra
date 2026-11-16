import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { readSavedState } from "#session/saved-state/read.ts"
import type { SavedState } from "#session/saved-state/schema.ts"
import { SAVED_STATE_VERSION } from "#session/saved-state/schema.ts"
import { buildSavedStateDeleteScript, buildSavedStateWriteScript } from "#session/saved-state/write.ts"
import type { Shell } from "#transport/transport.ts"

/**
 * A host's saved state, read once and kept in memory. Each write replaces the whole file from that copy. It doesn't
 * know the mode, so only call the functions that write in `apply`.
 */
export interface SavedStateManager {
  /** Reports whether `stepName` has an open change. */
  isOpen: (stepName: string) => boolean
  /** Opens a fresh change for `stepName`, with no follow-ups listed, in place of any change it already has open. */
  openChange: (stepName: string) => Promise<Result>
  /**
   * Returns the steps in `stepNames` whose change is open, but whose completed follow-ups don't list `followUpName`.
   * Their changes trigger the follow-up again, because it hasn't run after them.
   */
  getOpenChangesMissingFollowUp: (followUpName: string, stepNames: string[]) => string[]
  /** Adds `followUpName` to the open change of each step in `stepNames` that has one and doesn't list it yet. */
  recordFollowUp: (followUpName: string, stepNames: string[]) => Promise<Result>
  /** Closes every open change, which deletes the file while open changes are all it holds. */
  closeAll: () => Promise<Result>
}

type OpenChanges = SavedState["openChanges"]

/**
 * Reads the saved state at `savedStatePath` with `shell`, and returns its manager, which writes only through that shell
 * and to that path. Fails when the file can't be read, or isn't saved state tsinfra wrote.
 */
export const createSavedStateManager = async (
  shell: Shell,
  savedStatePath: string,
): Promise<Result<SavedStateManager>> => {
  const fileSavedState = await readSavedState(shell, savedStatePath)
  if (isErr(fileSavedState)) return fileSavedState

  // Keep `undefined` while there's no file, so a missing file never stands in as an empty saved state.
  let savedState: SavedState | undefined = fileSavedState

  const getOpenChanges = (): OpenChanges => savedState?.openChanges ?? {}

  // Give a step with no open change an empty list, so callers check `isOpen` for that and never read `undefined`.
  const getCompletedFollowUps = (stepName: string): string[] => {
    const openChanges = getOpenChanges()
    return openChanges[stepName] ?? []
  }

  // Change the copy in memory only after the write succeeds, so it always matches the file.
  const writeOpenChanges = async (openChanges: OpenChanges): Promise<Result> => {
    const nextSavedState: SavedState = { version: SAVED_STATE_VERSION, openChanges }
    const savedStateWriteScript = buildSavedStateWriteScript(savedStatePath, nextSavedState)
    const stateWrite = await shell.exec(savedStateWriteScript)
    if (isErr(stateWrite)) return err(`failed to write the saved state to '${savedStatePath}'`, stateWrite)

    savedState = nextSavedState
  }

  const isOpen = (stepName: string) => Object.hasOwn(getOpenChanges(), stepName)

  const openChange = async (stepName: string): Promise<Result> => {
    // Skip the write when the change is already open and fresh, because the file wouldn't change.
    if (isOpen(stepName) && getCompletedFollowUps(stepName).length === 0) return

    return writeOpenChanges({ ...getOpenChanges(), [stepName]: [] })
  }

  const getOpenChangesMissingFollowUp = (followUpName: string, stepNames: string[]) =>
    stepNames.filter((stepName) => isOpen(stepName) && !getCompletedFollowUps(stepName).includes(followUpName))

  const recordFollowUp = async (followUpName: string, stepNames: string[]): Promise<Result> => {
    const openChangesMissingFollowUp = getOpenChangesMissingFollowUp(followUpName, stepNames)
    // Skip the write when every step already lists the follow-up or has no open change, because the file wouldn't change.
    if (openChangesMissingFollowUp.length === 0) return

    const recordedChanges = openChangesMissingFollowUp.map((stepName): [string, string[]] => [
      stepName,
      [...getCompletedFollowUps(stepName), followUpName],
    ])

    return writeOpenChanges({ ...getOpenChanges(), ...Object.fromEntries(recordedChanges) })
  }

  const closeAll = async (): Promise<Result> => {
    // Skip the delete when there's no file, because nothing was read or written.
    if (savedState === undefined) return

    const savedStateDeleteScript = buildSavedStateDeleteScript(savedStatePath)
    const stateDelete = await shell.exec(savedStateDeleteScript)
    if (isErr(stateDelete)) return err(`failed to delete the saved state in '${savedStatePath}'`, stateDelete)

    savedState = undefined
  }

  return { isOpen, openChange, getOpenChangesMissingFollowUp, recordFollowUp, closeAll }
}
