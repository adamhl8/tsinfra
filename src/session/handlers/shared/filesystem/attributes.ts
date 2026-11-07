import { type } from "arktype"

import type { FileMode, ModeBits } from "#session/handlers/shared/filesystem/mode.ts"
import { OCTAL_MODE_PATTERN, SYMBOLIC_MODE_PATTERN } from "#session/handlers/shared/filesystem/mode.ts"

const fileOwnerSchema = type("string | number")
export type FileOwner = typeof fileOwnerSchema.infer

/** Who should own what a step writes. Something already there keeps its own value of any left out. */
export interface OwnerOptions {
  /** The user that owns it: a name is compared with its name, and a number with its uid. */
  user?: FileOwner
  /** The group that owns it: a name is compared with its name, and a number with its gid. */
  group?: FileOwner
}

/** The owner options every step that writes something takes, for its options schema to merge. */
export const ownerOptionsSchema = type
  .declare<OwnerOptions>()
  .type({ "user?": fileOwnerSchema, "group?": fileOwnerSchema })

/** What a file step manages besides its content. An existing file keeps its own value of any left out. */
export interface FileAttributeOptions extends OwnerOptions {
  /**
   * The file's mode, in octal like `"644"`, symbolic like `"rw-r--r--"`, or a constant like `PUBLIC_FILE_MODE`. An
   * existing file keeps its own when this is left out.
   */
  mode?: FileMode
}

const fileModeSchema = type(OCTAL_MODE_PATTERN).or(type(SYMBOLIC_MODE_PATTERN))

export const fileAttributeOptionsSchema = type
  .declare<FileAttributeOptions>()
  .type(ownerOptionsSchema.merge({ "mode?": fileModeSchema }))

/** Who owns something on the host. */
export interface HostOwner {
  uid: number
  gid: number
  user: string
  group: string
}

/** What the file details command found about the mode and owner of a regular file. */
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
