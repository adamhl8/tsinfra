import { type } from "arktype"

// Bump `SAVED_STATE_VERSION` when the file's shape changes, so an older tsinfra fails on a newer file instead of
// misreading it.
export const SAVED_STATE_VERSION = 1

// Map each step's name to the runs that already ran after its open change.
const savedStateSchema = type({
  version: type.unit(SAVED_STATE_VERSION),
  openChanges: "Record<string, string[]>",
})
export type SavedState = typeof savedStateSchema.infer

export const savedStateFileSchema = type("string.json.parse").to(savedStateSchema)
