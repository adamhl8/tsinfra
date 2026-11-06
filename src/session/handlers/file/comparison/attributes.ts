import type { FileAttributeName, FileAttributeOptions } from "#session/handlers/file.ts"
import type { HostFileAttributeDetails } from "#session/handlers/file/comparison/host-file-details.ts"
import { toModeBits } from "#session/handlers/file/mode.ts"

export type AttributeValue = string | number

/** A managed attribute of a file whose value differs, as raw values. `name` says how the output shows them. */
export interface AttributeChange {
  name: FileAttributeName
  got: AttributeValue
  want: AttributeValue
}

/** Lists the given attributes whose value on the host differs, comparing a name with a name and a number with an id. */
export const findAttributeChanges = (
  hostAttributeDetails: HostFileAttributeDetails,
  options: FileAttributeOptions,
): AttributeChange[] => {
  const { mode, user, group } = options
  const { mode: gotMode } = hostAttributeDetails

  const changes: AttributeChange[] = []

  const wantMode = mode === undefined ? undefined : toModeBits(mode)
  const isModeChanged = wantMode !== undefined && gotMode !== wantMode
  if (isModeChanged) changes.push({ name: "mode", got: gotMode, want: wantMode })

  const gotUser = typeof user === "number" ? hostAttributeDetails.uid : hostAttributeDetails.user
  if (user !== undefined && gotUser !== user) changes.push({ name: "user", got: gotUser, want: user })

  const gotGroup = typeof group === "number" ? hostAttributeDetails.gid : hostAttributeDetails.group
  if (group !== undefined && gotGroup !== group) changes.push({ name: "group", got: gotGroup, want: group })

  return changes
}
