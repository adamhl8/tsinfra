import type {
  AttributeChange,
  FileAttributeOptions,
  HostFileAttributeDetails,
} from "#session/handlers/shared/filesystem/attributes.ts"
import { toModeBits } from "#session/handlers/shared/filesystem/mode.ts"
import { findOwnerChanges } from "#session/handlers/shared/filesystem/owner.ts"

/** Lists the given attributes whose value on the host differs, comparing a name with a name and a number with an id. */
export const findAttributeChanges = (
  hostAttributeDetails: HostFileAttributeDetails,
  options: FileAttributeOptions,
): AttributeChange[] => {
  const { mode: gotMode } = hostAttributeDetails
  const { mode } = options

  const changes: AttributeChange[] = []

  const wantMode = mode === undefined ? undefined : toModeBits(mode)
  const isModeChanged = wantMode !== undefined && gotMode !== wantMode
  if (isModeChanged) changes.push({ name: "mode", got: gotMode, want: wantMode })

  return [...changes, ...findOwnerChanges(hostAttributeDetails, options)]
}
