import type { FileAttributes } from "#session/handlers/file.ts"
import type { HostFileDetails } from "#session/handlers/file/comparison/host-file-details.ts"
import { formatMode, toModeBits } from "#session/handlers/file/mode.ts"

/** A managed attribute of a file whose value differs, as the output shows it. */
export interface AttributeChange {
  name: keyof FileAttributes
  got: string
  want: string
}

/** Lists the given attributes whose value on the host differs, comparing a name with a name and a number with an id. */
export const findAttributeChanges = (
  hostFileDetails: HostFileDetails,
  attributes: FileAttributes,
): AttributeChange[] => {
  const { mode, user, group } = attributes
  const changes: AttributeChange[] = []

  const { mode: gotMode } = hostFileDetails
  const wantMode = mode === undefined ? undefined : toModeBits(mode)
  const isModeChanged = wantMode !== undefined && gotMode !== wantMode
  if (isModeChanged) changes.push({ name: "mode", got: formatMode(gotMode), want: formatMode(wantMode) })

  const gotUser = typeof user === "number" ? hostFileDetails.uid : hostFileDetails.user
  if (user !== undefined && gotUser !== user) changes.push({ name: "user", got: String(gotUser), want: String(user) })

  const gotGroup = typeof group === "number" ? hostFileDetails.gid : hostFileDetails.group
  if (group !== undefined && gotGroup !== group)
    changes.push({ name: "group", got: String(gotGroup), want: String(group) })

  return changes
}
