import process from "node:process"

import { messageChain } from "ts-explicit-errors"

import { getPreparationFailure, toLoadedHost } from "#__tests__/session.ts"
import { host } from "#hosts/host.ts"
import { prepareHosts } from "#hosts/prepare/prepare.ts"

const doNothing = async () => {
  /* empty */
}

// Prepare a `sudo: true` host on `@local` for each name given, and print how each one ended.
const names = process.argv.slice(2)
const hostEntries = await prepareHosts(
  names.map((name) => toLoadedHost(name, host("@local", doNothing, { sudo: true }))),
)
const results = hostEntries.map((hostEntry) => [
  hostEntry.loadedHost.name,
  "hostContext" in hostEntry ? "prepared" : messageChain(getPreparationFailure(hostEntry.hostRecorder.hostRecord)),
])
console.log(JSON.stringify(results))
