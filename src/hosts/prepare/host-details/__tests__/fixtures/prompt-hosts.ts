import process from "node:process"

import { messageChain } from "ts-explicit-errors"

import { getPreparationFailure, toLoadedHost } from "#__tests__/session.ts"
import { host } from "#hosts/host.ts"
import { prepareHosts } from "#hosts/prepare/prepare.ts"

const doNothing = async () => {
  /* empty */
}

// Prepare a `sudo: true` host on `@local` for each name given, and print how each one ended.
// Pass `--records` first to also print each host's record, so a test can check what reached it.
const args = process.argv.slice(2)
const isPrintingRecords = args[0] === "--records"
const names = isPrintingRecords ? args.slice(1) : args

const hostEntries = await prepareHosts(
  names.map((name) => toLoadedHost(name, host("@local", doNothing, { sudo: true }))),
)
const results = hostEntries.map((hostEntry) => [
  hostEntry.loadedHost.name,
  hostEntry.sessionContext ? "prepared" : messageChain(getPreparationFailure(hostEntry.hostRecord)),
])
console.log(JSON.stringify(results))

if (isPrintingRecords) {
  const hostRecords = hostEntries.map(({ hostRecord }) => hostRecord)
  console.log(JSON.stringify(hostRecords))
}
