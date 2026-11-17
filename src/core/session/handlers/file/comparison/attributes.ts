import type { FileAttributeOptions } from "#core/session/handlers/options/handler.ts"
import type { AttributeChange, HostFileAttributeDetails } from "#core/session/handlers/shared/filesystem/attributes.ts"
import { parseFileMode } from "#core/session/handlers/shared/filesystem/mode.ts"
import { findOwnerChanges } from "#core/session/handlers/shared/filesystem/owner.ts"

/** Lists the given attributes whose value on the host differs, comparing a name with a name and a number with an id. */
export const findAttributeChanges = (
  attributes: HostFileAttributeDetails,
  options: FileAttributeOptions,
): AttributeChange[] => {
  const { mode: gotMode } = attributes
  const { mode } = options

  const changes: AttributeChange[] = []

  const wantMode = mode === undefined ? undefined : parseFileMode(mode)
  const isModeChanged = wantMode !== undefined && gotMode !== wantMode
  if (isModeChanged) changes.push({ name: "mode", got: gotMode, want: wantMode })

  return [...changes, ...findOwnerChanges(attributes, options)]
}
