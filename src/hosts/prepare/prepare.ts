import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { LoadedHost } from "#hosts/load.ts"
import type { HostDetails, ReadyHostDetails } from "#hosts/prepare/host-details/host-details.ts"
import { buildHostDetails, finishHostDetails } from "#hosts/prepare/host-details/host-details.ts"
import { createHostRecord, createPreparationRecorder, createSessionRecorder } from "#session/session.ts"
import type { SessionContext, HostRecord } from "#session/session.ts"

/** A host after preparation: what its script defines, the record of its run, and its context if it was prepared. */
export interface HostEntry {
  loadedHost: LoadedHost
  hostRecord: HostRecord
  /**
   * Unset on an entry `prepareHosts` returns when preparation failed, like for an unreachable host, so its script never
   * runs. The record holds why. Unset too while `prepareHosts` is still preparing the host.
   */
  sessionContext?: SessionContext
}

/**
 * Finishes the details of `hostEntry`'s host, prompting for its sudo password when it has no transport yet, and builds
 * its context. Hand the session a recorder on the host's final transport, which ends preparation's part of the record.
 */
const buildSessionContext = async (
  hostEntry: HostEntry,
  hostDetails: HostDetails | ReadyHostDetails,
): Promise<Result<SessionContext>> => {
  const { loadedHost, hostRecord } = hostEntry
  const readyHostDetails = "transport" in hostDetails ? hostDetails : await finishHostDetails(loadedHost, hostDetails)
  if (isErr(readyHostDetails)) return readyHostDetails

  const { home, transport } = readyHostDetails
  const sessionRecorder = createSessionRecorder(hostRecord, loadedHost.options, transport)
  return { name: loadedHost.name, home, sessionRecorder }
}

/**
 * Prepares every host at once, before any script runs, and keeps them in order. Prompts for sudo passwords after every
 * host is prepared, one host at a time, so the prompts come in the hosts' order.
 */
export const prepareHosts = async (loadedHosts: LoadedHost[]): Promise<HostEntry[]> => {
  const preparedHosts = await Promise.all(
    loadedHosts.map(async (loadedHost) => {
      const hostRecord = createHostRecord(loadedHost.name, loadedHost.target)
      const preparationRecorder = createPreparationRecorder(hostRecord, loadedHost.options)
      const hostDetails = await buildHostDetails(loadedHost, preparationRecorder)
      const hostEntry: HostEntry = { loadedHost, hostRecord }
      return { hostEntry, preparationRecorder, hostDetails }
    }),
  )

  const hostEntries: HostEntry[] = []
  for (const { hostEntry, preparationRecorder, hostDetails } of preparedHosts) {
    const sessionContext = isErr(hostDetails)
      ? hostDetails
      : // oxlint-disable-next-line no-await-in-loop - prompts run one at a time
        await buildSessionContext(hostEntry, hostDetails)

    if (isErr(sessionContext)) {
      preparationRecorder.recordFailure(sessionContext)
      hostEntries.push(hostEntry)
      continue
    }

    hostEntries.push({ ...hostEntry, sessionContext })
  }

  return hostEntries
}
