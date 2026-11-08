import process from "node:process"

import { isErr, messageChain } from "ts-explicit-errors"

import { toLoadedHost } from "#__tests__/session.ts"
import { host } from "#hosts/host.ts"
import { prepareHosts } from "#hosts/run.ts"

const doNothing = async () => {
  /* empty */
}

// Prepare a `sudo: true` host on `@local` for each name given, and print how each one ended.
const names = process.argv.slice(2)
const preparedHosts = await prepareHosts(
  names.map((name) => toLoadedHost(name, host("@local", doNothing, { sudo: true }))),
)
const results = preparedHosts.map(({ loadedHost, hostContext }) => [
  loadedHost.name,
  isErr(hostContext) ? messageChain(hostContext) : "prepared",
])
console.log(JSON.stringify(results))
