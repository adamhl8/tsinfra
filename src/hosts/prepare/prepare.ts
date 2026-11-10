import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { LoadedHost } from "#hosts/load.ts"
import type { HostDetails, ReadyHostDetails } from "#hosts/prepare/host-details/host-details.ts"
import { buildHostDetails, finishHostDetails } from "#hosts/prepare/host-details/host-details.ts"
import { getPreparationFailureHints } from "#session/session.ts"
import type { HostContext } from "#session/session.ts"

/** A host that preflight prepared, ready to run. */
interface PreparedHostEntry {
  loadedHost: LoadedHost
  hostContext: HostContext
}

/** A host that preflight couldn't prepare, like an unreachable one, so its script never runs. */
interface UnpreparedHostEntry {
  loadedHost: LoadedHost
  failure: Error
  failureHints: string[]
}

/** What preparing a host gave: a host ready to run, or one that couldn't be prepared. */
export type HostEntry = PreparedHostEntry | UnpreparedHostEntry

/** Finishes a host's details, prompting for its sudo password when it has no transport yet, and builds its context. */
const buildHostContext = async (
  loadedHost: LoadedHost,
  hostDetails: HostDetails | ReadyHostDetails,
): Promise<Result<HostContext>> => {
  const readyHostDetails = "transport" in hostDetails ? hostDetails : await finishHostDetails(loadedHost, hostDetails)
  if (isErr(readyHostDetails)) return readyHostDetails

  const { name, options } = loadedHost
  const { home, transport } = readyHostDetails
  return { name, transport, home, options }
}

/**
 * Prepares every host at once, before any script runs, and keeps them in order. Prompts for sudo passwords after every
 * host is prepared, one host at a time, so the prompts come in the hosts' order.
 */
export const prepareHosts = async (loadedHosts: LoadedHost[]): Promise<HostEntry[]> => {
  const builtHostDetails = await Promise.all(
    loadedHosts.map(async (loadedHost) => ({ loadedHost, hostDetails: await buildHostDetails(loadedHost) })),
  )

  const hostEntries: HostEntry[] = []
  for (const { loadedHost, hostDetails } of builtHostDetails) {
    // oxlint-disable-next-line no-await-in-loop - prompts run one at a time
    const hostContext = isErr(hostDetails) ? hostDetails : await buildHostContext(loadedHost, hostDetails)
    const hostEntry = isErr(hostContext)
      ? { loadedHost, failure: hostContext, failureHints: getPreparationFailureHints(loadedHost.target, hostContext) }
      : { loadedHost, hostContext }
    hostEntries.push(hostEntry)
  }
  return hostEntries
}
