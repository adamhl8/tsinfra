import { toHostBlockEntries } from "#report/build/entries.ts"
import type { HostBlock } from "#report/host-block.ts"
import type { ReportOptions } from "#report/report.ts"
import type { HostRecord } from "#session/session.ts"

/**
 * Returns a host's block: an entry per step that shows, then the host's failure, if it failed. A host whose script made
 * no steps and didn't fail gets "no steps" instead, so it's clear the host ran.
 */
export const toHostBlock = (hostRecord: HostRecord, reportOptions: ReportOptions): HostBlock => {
  const { name, stepRecords, failure } = hostRecord
  if (stepRecords.length === 0 && !failure) return { name, kind: "noSteps" }

  return { name, kind: "entries", entries: toHostBlockEntries(hostRecord, reportOptions) }
}
