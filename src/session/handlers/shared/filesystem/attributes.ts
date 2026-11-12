import type { ModeBits } from "#session/handlers/shared/filesystem/mode.ts"
import type { FileOwner, OwnerOptions } from "#session/handlers/step-options/step-options.ts"

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
