import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { LoadedHost } from "#hosts/load.ts"
import type { HostDetails, ReadyHostDetails } from "#hosts/prepare/host-details/host-details.ts"
import { buildHostDetails, finishHostDetails } from "#hosts/prepare/host-details/host-details.ts"
import { createHostRecorder } from "#session/session.ts"
import type { HostContext, HostRecorder } from "#session/session.ts"

/** A prepared host, ready to run. Its context carries its recorder. */
interface PreparedHostEntry {
  loadedHost: LoadedHost
  hostContext: HostContext
}

/** A host whose preparation failed, like an unreachable one, so its script never runs. Its record holds why. */
interface UnpreparedHostEntry {
  loadedHost: LoadedHost
  hostRecorder: HostRecorder
}

/** What preparing a host gave: a host ready to run, or one that couldn't be prepared. */
export type HostEntry = PreparedHostEntry | UnpreparedHostEntry

/** Finishes a host's details, prompting for its sudo password when it has no transport yet, and builds its context. */
const buildHostContext = async (
  loadedHost: LoadedHost,
  hostDetails: HostDetails | ReadyHostDetails,
  hostRecorder: HostRecorder,
): Promise<Result<HostContext>> => {
  const readyHostDetails = "transport" in hostDetails ? hostDetails : await finishHostDetails(loadedHost, hostDetails)
  if (isErr(readyHostDetails)) return readyHostDetails

  const { home, transport } = readyHostDetails
  return { name: loadedHost.name, transport, home, hostRecorder }
}

/**
 * Prepares every host at once, before any script runs, and keeps them in order. Prompts for sudo passwords after every
 * host is prepared, one host at a time, so the prompts come in the hosts' order.
 */
export const prepareHosts = async (loadedHosts: LoadedHost[]): Promise<HostEntry[]> => {
  const builtHostDetails = await Promise.all(
    loadedHosts.map(async (loadedHost) => ({
      loadedHost,
      hostRecorder: createHostRecorder(loadedHost.name, loadedHost.target, loadedHost.options),
      hostDetails: await buildHostDetails(loadedHost),
    })),
  )

  const hostEntries: HostEntry[] = []
  for (const { loadedHost, hostRecorder, hostDetails } of builtHostDetails) {
    const hostContext = isErr(hostDetails)
      ? hostDetails
      : // oxlint-disable-next-line no-await-in-loop - prompts run one at a time
        await buildHostContext(loadedHost, hostDetails, hostRecorder)

    if (isErr(hostContext)) {
      hostRecorder.failPreparation(hostContext)
      hostEntries.push({ loadedHost, hostRecorder })
      continue
    }

    hostRecorder.finishPreparation()
    hostEntries.push({ loadedHost, hostContext })
  }
  return hostEntries
}
