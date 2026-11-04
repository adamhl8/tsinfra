#!/usr/bin/env bun
import process from "node:process"

import { run } from "@optique/run"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { program } from "#cli/program.ts"
import { discoverHosts } from "#hosts/discover.ts"
import { loadHosts } from "#hosts/load.ts"
import type { HostReport } from "#hosts/run.ts"
import { getExitCode, prepareHosts, runHost } from "#hosts/run.ts"
import packageJson from "#package.json" with { type: "json" }
import { ERROR_THEME, printTsinfraError } from "#report/errors.ts"
import { formatHostBlock, formatSummary } from "#report/format.ts"

/** Runs the hosts, prints each one's host block and then the summary, and returns the exit code. */
const runTsinfra = async (): Promise<Result<number>> => {
  const config = run(program, { help: "option", version: packageJson.version, showDefault: true, theme: ERROR_THEME })

  const hostScripts = await discoverHosts(config.hostsDir, config.hosts)
  if (isErr(hostScripts)) return err("failed to discover hosts", hostScripts)

  const loadedHosts = await loadHosts(hostScripts)
  if (isErr(loadedHosts)) return loadedHosts

  const preparedHosts = await prepareHosts(loadedHosts)

  const hostReports: HostReport[] = []

  for (const preparedHost of preparedHosts) {
    // oxlint-disable-next-line no-await-in-loop - hosts run one at a time until there's a parallel option
    const hostReport = await runHost(preparedHost, config.mode)
    hostReports.push(hostReport)

    const hostBlock = formatHostBlock(hostReport, { verbose: config.verbose })
    if (hostBlock) console.log(`${hostBlock}\n`)
  }

  console.log(formatSummary(hostReports, config.mode))

  return getExitCode(hostReports, config.mode)
}

const main = async (): Promise<number> => {
  const exitCode = await runTsinfra()
  if (isErr(exitCode)) {
    printTsinfraError(exitCode)
    return 1
  }

  return exitCode
}

process.exitCode = await main()
