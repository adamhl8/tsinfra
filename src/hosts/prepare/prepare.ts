import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { HostFunction } from "#hosts/hosts.ts"
import type { LoadedHost } from "#hosts/load.ts"
import type { HostDetails } from "#hosts/prepare/host-details/host-details.ts"
import { buildHostDetails, finishHostDetails, toSavedStatePath } from "#hosts/prepare/host-details/host-details.ts"
import {
  createHostRecord,
  createPreparationRecorder,
  createSavedStateManager,
  createSessionRecorder,
} from "#session/session.ts"
import type { HostRecord, PreparationRecorder, SavedStateManager, SessionContext } from "#session/session.ts"
import { createShell } from "#transport/transport.ts"

export type { HomeDirectory } from "#hosts/prepare/host-details/host-details.ts"

/** A host after preparation: ready to run its function, or failed, with the record that says why. */
export type HostEntry = PreparedHostEntry | FailedHostEntry

/** A host that's ready to run: its function, its record, and the context its session is built from. */
interface PreparedHostEntry {
  preparation: "prepared"
  hostFn: HostFunction
  hostRecord: HostRecord
  sessionContext: SessionContext
}

/** A host whose preparation failed, so its function never runs. Its record holds why. */
interface FailedHostEntry {
  preparation: "failed"
  hostRecord: HostRecord
}

/** How the part of preparation that runs for every host at once, before any password prompt, went for a host. */
type HostInitialization = InitializedHost | FailedInitialization

/** A host that's initialized, so it only needs its password prompt, if any, and its session context. */
interface InitializedHost {
  initialization: "initialized"
  loadedHost: LoadedHost
  hostRecord: HostRecord
  preparationRecorder: PreparationRecorder
  hostDetails: HostDetails
  savedStateManager: SavedStateManager
}

/** A host that failed to initialize, with the record and recorder its failure goes on. */
interface FailedInitialization {
  initialization: "failed"
  hostRecord: HostRecord
  preparationRecorder: PreparationRecorder
  error: Error
}

/**
 * Creates the host's record, builds its details, and reads its saved state. Reads it through a shell on the base
 * transport that records nothing, because saved state is tsinfra's own and never needs sudo, so it works before a
 * password prompt too.
 */
const initializeHost = async (loadedHost: LoadedHost): Promise<HostInitialization> => {
  const hostRecord = createHostRecord(loadedHost.name, loadedHost.target)
  const preparationRecorder = createPreparationRecorder(hostRecord, loadedHost.options)

  const hostDetails = await buildHostDetails(loadedHost, preparationRecorder)
  if (isErr(hostDetails)) return { initialization: "failed", hostRecord, preparationRecorder, error: hostDetails }

  const savedStatePath = toSavedStatePath(hostDetails.home, loadedHost.name)
  const savedStateManager = await createSavedStateManager(createShell(hostDetails.baseTransport), savedStatePath)
  if (isErr(savedStateManager))
    return { initialization: "failed", hostRecord, preparationRecorder, error: savedStateManager }

  return { initialization: "initialized", loadedHost, hostRecord, preparationRecorder, hostDetails, savedStateManager }
}

/**
 * Finishes preparing an initialized host: prompts for its sudo password when it has no transport yet, then builds its
 * session context. Hand the session a recorder on the host's final transport, which ends preparation's part of the
 * record.
 */
const finishHost = async (initializedHost: InitializedHost): Promise<Result<PreparedHostEntry>> => {
  const { loadedHost, hostRecord, hostDetails, savedStateManager } = initializedHost
  const readyHostDetails = hostDetails.kind === "ready" ? hostDetails : await finishHostDetails(loadedHost, hostDetails)
  if (isErr(readyHostDetails)) return readyHostDetails

  const { home, transport } = readyHostDetails
  const sessionRecorder = createSessionRecorder(hostRecord, loadedHost.options, transport)
  const sessionContext: SessionContext = { name: loadedHost.name, home, savedStateManager, sessionRecorder }
  return { preparation: "prepared", hostFn: loadedHost.fn, hostRecord, sessionContext }
}

/**
 * Prepares every host, and keeps them in order. Initializes every host at once, before any script runs, then finishes
 * them one at a time, so the sudo password prompts come in the hosts' order. A host that fails either part keeps its
 * record, with the failure on it.
 */
export const prepareHosts = async (loadedHosts: LoadedHost[]): Promise<HostEntry[]> => {
  const hostInitializations = await Promise.all(loadedHosts.map(async (loadedHost) => initializeHost(loadedHost)))

  const hostEntries: HostEntry[] = []
  for (const hostInitialization of hostInitializations) {
    const { hostRecord, preparationRecorder } = hostInitialization

    const failHost = (error: Error) => {
      preparationRecorder.recordFailure(error)
      hostEntries.push({ preparation: "failed", hostRecord })
    }

    if (hostInitialization.initialization === "failed") {
      failHost(hostInitialization.error)
      continue
    }

    // oxlint-disable-next-line no-await-in-loop - prompts run one at a time
    const preparedHost = await finishHost(hostInitialization)

    if (isErr(preparedHost)) {
      failHost(preparedHost)
      continue
    }

    hostEntries.push(preparedHost)
  }

  return hostEntries
}
