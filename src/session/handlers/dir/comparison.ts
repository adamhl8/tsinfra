import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { ValidDirOptions } from "#session/handlers/dir/dir.ts"
import type { HostDirDetails } from "#session/handlers/dir/host-dir-details.ts"
import type { RecordWant } from "#session/handlers/ensure/ensure.ts"
import { compareRecords } from "#session/handlers/ensure/ensure.ts"
import type { Comparison, HostFileAttributeDetails } from "#session/handlers/shared/shared.ts"
import { checkCanSetOwner, parseFileMode, toOctalMode } from "#session/handlers/shared/shared.ts"
import type { StepContext } from "#session/step.ts"

/** Returns what the script wants: the directory, and each attribute it gave, with the mode in octal. */
const toDirWant = (options: ValidDirOptions): RecordWant => {
  const { mode, user, group } = options

  return {
    exists: true,
    ...(mode !== undefined && { mode: toOctalMode(parseFileMode(mode)) }),
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
    ...(mode !== undefined && { mode: toOctalMode(attributes.mode) }),
    ...(user !== undefined && { user: typeof user === "number" ? attributes.uid : attributes.user }),
    ...(group !== undefined && { group: typeof group === "number" ? attributes.gid : attributes.group }),
  }
}

/**
 * Compares the directory's details on the host with what the script wants, as an object `want`, so the report shows
 * each key that differs as an object `ensure`'s row. Fails a write that can't work.
 */
export const compareDir = async (
  ctx: StepContext,
  hostDirDetails: HostDirDetails,
  options: ValidDirOptions,
): Promise<Result<Comparison>> => {
  const { shell } = ctx
  const { path } = hostDirDetails

  const attributes = hostDirDetails.kind === "new" ? undefined : hostDirDetails.attributes
  const comparison = compareRecords(toCurrentDirRecord(attributes, options), toDirWant(options))

  // Skip the owner check for a directory in sync, because no write is coming.
  if (comparison.inSync) return comparison

  const ownerCheck = await checkCanSetOwner(shell, path, attributes, options)
  return isErr(ownerCheck) ? ownerCheck : comparison
}
