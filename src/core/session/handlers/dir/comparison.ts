import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { HandlerContext } from "#core/session/context.ts"
import type { ValidDirOptions } from "#core/session/handlers/dir.ts"
import type { HostDirDetails } from "#core/session/handlers/dir/host-dir-details.ts"
import type { RecordWant } from "#core/session/handlers/ensure/comparison/record.ts"
import { compareRecords } from "#core/session/handlers/ensure/comparison/record.ts"
import type { Comparison } from "#core/session/handlers/shared/converge.ts"
import type { HostFileAttributeDetails } from "#core/session/handlers/shared/filesystem/attributes.ts"
import { parseFileMode } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import { checkCanSetOwner } from "#core/session/handlers/shared/filesystem/attributes/owner.ts"

/** Returns what the script wants: the directory, and each attribute it gave, with the mode as its bits. */
const toDirWant = (options: ValidDirOptions): RecordWant => {
  const { mode, user, group } = options

  return {
    exists: true,
    ...(mode !== undefined && { mode: parseFileMode(mode) }),
    ...(user !== undefined && { user }),
    ...(group !== undefined && { group }),
  }
}

/**
 * Returns what's at the path now, with the keys `want` has, so only what the script gave is compared. An owner given as
 * a number reads the directory's id, and one given as a name reads its name, the same rule as `file`.
 */
const toCurrentDirRecord = (attributes: HostFileAttributeDetails | undefined, options: ValidDirOptions): RecordWant => {
  const { mode, user, group } = options
  if (attributes === undefined) return { exists: false }

  return {
    exists: true,
    ...(mode !== undefined && { mode: attributes.mode }),
    ...(user !== undefined && { user: typeof user === "number" ? attributes.uid : attributes.user }),
    ...(group !== undefined && { group: typeof group === "number" ? attributes.gid : attributes.group }),
  }
}

/**
 * Compares the directory's details on the host with what the script wants, as a record `want`, so the report shows each
 * key that differs as a record `want`'s row. Fails a write that can't work.
 */
export const compareDir = async (
  ctx: HandlerContext,
  hostDirDetails: HostDirDetails,
  options: ValidDirOptions,
): Promise<Result<Comparison>> => {
  const { shell } = ctx.step
  const { path } = hostDirDetails

  const attributes = hostDirDetails.kind === "new" ? undefined : hostDirDetails.attributes
  const comparison = compareRecords(toCurrentDirRecord(attributes, options), toDirWant(options))

  // Skip the owner check for a directory in sync, because no write is coming.
  if (comparison.inSync) return comparison

  const ownerCheck = await checkCanSetOwner(shell, path, attributes, options)
  return isErr(ownerCheck) ? ownerCheck : comparison
}
