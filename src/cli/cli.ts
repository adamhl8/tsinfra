#!/usr/bin/env bun
import process from "node:process"

import { run } from "@optique/run"
import type { Result } from "ts-explicit-errors"
import { err, isErr, messageChain } from "ts-explicit-errors"

import { program } from "#cli/program.ts"
import { discoverHosts } from "#hosts/discover.ts"
import { loadHosts } from "#hosts/load.ts"
import { runHost } from "#hosts/run.ts"
import packageJson from "#package.json" with { type: "json" }

/** Runs the hosts and returns the exit code: 1 when any host failed. */
const runTsinfra = async (): Promise<Result<number>> => {
  const config = run(program, { help: "option", version: packageJson.version, showDefault: true })

  const hostFiles = await discoverHosts(config.hostsDir, config.hosts)
  if (isErr(hostFiles)) return err("failed to discover hosts", hostFiles)

  const hostEntries = await loadHosts(hostFiles)
  if (isErr(hostEntries)) return hostEntries

  let hasFailedHost = false
  for (const hostEntry of hostEntries) {
    // oxlint-disable-next-line no-await-in-loop - hosts run one at a time until there's a parallel option
    const result = await runHost(hostEntry)
    if (isErr(result)) {
      console.error(messageChain(result))
      hasFailedHost = true
    } else console.log(`${hostEntry.name} ok`)
  }

  return hasFailedHost ? 1 : 0
}

const main = async (): Promise<number> => {
  const exitCode = await runTsinfra()
  if (isErr(exitCode)) {
    console.error(messageChain(exitCode))
    return 1
  }

  return exitCode
}

process.exitCode = await main()
