import { mock } from "bun:test"
import process from "node:process"

import { makeTempDir } from "@adamhl8/configs/test"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { LoadedHost } from "#core/hosts/load.ts"
import type { HomeDirectory } from "#core/hosts/prepare/host-details.ts"

import "@adamhl8/configs/test/preload"

// Turn colors off before any test imports picocolors, because it decides once, and a terminal would turn them on.
process.env["NO_COLOR"] = "1"
// Clear `FORCE_COLOR`, because `bask` sets it in a terminal, and `getErrorColors` prefers it over `NO_COLOR`.
process.env["FORCE_COLOR"] = ""

// Load the real module before mocking it, so the mock can call its `buildHostDetails`.
const hostDetails = await import("#core/hosts/prepare/host-details.ts")
const { buildHostDetails } = hostDetails

// Keep each host's home by its `LoadedHost`, so a test that prepares the same host twice finds its saved state again.
const homesByLoadedHost = new WeakMap<LoadedHost, HomeDirectory>()

/** Returns the temp home of `loadedHost`, making one the first time the host is prepared. */
const getTestHome = async (loadedHost: LoadedHost): Promise<Result<HomeDirectory>> => {
  const knownHome = homesByLoadedHost.get(loadedHost)
  if (knownHome) return knownHome

  const home = hostDetails.validateHome(await makeTempDir())
  if (isErr(home)) return home

  homesByLoadedHost.set(loadedHost, home)
  return home
}

// Give each host a home of its own, so a test never touches the real home's saved state or another test's.
// Swap the home preparation read, because commands get the `HOME` the test run started with, so `HOME` can't move.
// Give an ssh host one too, because the only sshds the tests reach run on this machine as the same user.
await mock.module("#core/hosts/prepare/host-details.ts", () => ({
  ...hostDetails,
  buildHostDetails: async (...args: Parameters<typeof buildHostDetails>) => {
    const [loadedHost] = args
    const builtHostDetails = await buildHostDetails(...args)
    if (isErr(builtHostDetails)) return builtHostDetails

    const home = await getTestHome(loadedHost)
    if (isErr(home)) return home

    return { ...builtHostDetails, home }
  },
}))
