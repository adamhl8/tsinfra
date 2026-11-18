import process from "node:process"

import { messageChain } from "ts-explicit-errors"

import { getPreparationFailure, loadHostDefinition } from "#core/__tests__/session.ts"
import { host } from "#core/hosts/host.ts"
import { finishHosts, initializeHosts } from "#core/hosts/prepare.ts"

const doNothing = async () => {
  /* empty */
}

// Prepare a `sudo: true` host on `@local` for each name given, and print how each one ended.
// Pass `--records` first to also print each host's record, so a test can check what reached it.
const args = process.argv.slice(2)
const isPrintingRecords = args[0] === "--records"
const names = isPrintingRecords ? args.slice(1) : args

const hostInitializations = await initializeHosts(
  names.map((name) => loadHostDefinition(host({ name, target: "@local", sudo: true }, doNothing))),
)
const hostEntries = await finishHosts(hostInitializations)
const results = hostEntries.map((hostEntry) => [
  hostEntry.hostRecord.name,
  hostEntry.preparation === "prepared" ? "prepared" : messageChain(getPreparationFailure(hostEntry.hostRecord)),
])
console.log(JSON.stringify(results))

if (isPrintingRecords) {
  const hostRecords = hostEntries.map(({ hostRecord }) => hostRecord)
  console.log(JSON.stringify(hostRecords))
}
