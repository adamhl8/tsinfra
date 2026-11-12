import { toHostBlockEntries } from "#report/build/entries.ts"
import type { HostBlock } from "#report/host-block.ts"
import type { HostRecord } from "#session/session.ts"

/**
 * Returns a host's block, with every piece at every level, each with the level it shows from: an entry per finished
 * step, then the host's failure, if it failed. A host whose script made no steps and didn't fail gets "no steps"
 * instead, so it's clear the host ran.
 */
export const toHostBlock = (hostRecord: HostRecord): HostBlock => {
  const { name, stepRecords, failure } = hostRecord
  if (stepRecords.length === 0 && !failure) return { name, kind: "noSteps" }

  const entries = toHostBlockEntries(hostRecord)
  return { name, kind: "entries", entries }
}
