import { mock } from "bun:test"
import process from "node:process"

import { makeTempDir } from "@adamhl8/configs/test"
import { isErr } from "ts-explicit-errors"

import { LOCAL_TARGET } from "#transport/transport.ts"

import "@adamhl8/configs/test/preload"

// Turn colors off before any test imports picocolors, because it decides once, and a terminal would turn them on.
process.env["NO_COLOR"] = "1"
// Clear `FORCE_COLOR`, because `bask` sets it in a terminal, and `getErrorColors` prefers it over `NO_COLOR`.
process.env["FORCE_COLOR"] = ""

// Load the real module before mocking it, so the mock can call its `buildHostDetails`.
const hostDetails = await import("#hosts/prepare/host-details/host-details.ts")
const { buildHostDetails } = hostDetails

// Give each `@local` host a home of its own, so a test never touches the real home's saved state or another test's.
// Swap the home preparation read, because commands get the `HOME` the test run started with, so `HOME` can't move.
await mock.module("#hosts/prepare/host-details/host-details.ts", () => ({
  ...hostDetails,
  buildHostDetails: async (...args: Parameters<typeof buildHostDetails>) => {
    const [loadedHost] = args
    const builtHostDetails = await buildHostDetails(...args)
    if (isErr(builtHostDetails) || loadedHost.target !== LOCAL_TARGET) return builtHostDetails

    const home = hostDetails.validateHome(await makeTempDir())
    if (isErr(home)) return home

    return { ...builtHostDetails, home }
  },
}))
