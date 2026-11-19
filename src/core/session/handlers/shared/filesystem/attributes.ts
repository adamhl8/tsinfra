import type { FileAttributeOptions, FileOwner, OwnerOptions } from "#core/session/handlers/options/attributes.ts"
import type { ModeBits } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import { parseFileMode } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import { findOwnerChanges } from "#core/session/handlers/shared/filesystem/attributes/owner.ts"

/** Who owns something on the host. */
export interface HostOwner {
  uid: number
  gid: number
  user: string
  group: string
}

/** What the file details script found about the mode and owner of a regular file. */
export interface HostFileAttributeDetails extends HostOwner {
  mode: ModeBits
}

/** An owner that differs, as raw values: a name, or a uid or gid when the script gave a number. */
export interface OwnerChange {
  name: keyof OwnerOptions
  got: FileOwner
  want: FileOwner
}

/** A file's mode that differs, as mode bits. */
interface ModeChange {
  name: "mode"
  got: ModeBits
  want: ModeBits
}

/** A managed attribute of a file whose value differs. `name` says how the output shows it. */
export type AttributeChange = ModeChange | OwnerChange

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
