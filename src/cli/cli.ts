#!/usr/bin/env bun
import process from "node:process"

import { run } from "@optique/run"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { program } from "#cli/program.ts"
import { discoverHosts } from "#hosts/discover.ts"
import { loadHosts } from "#hosts/load.ts"
import type { HostReport } from "#hosts/run.ts"
import { hasPendingChange, runHost } from "#hosts/run.ts"
import packageJson from "#package.json" with { type: "json" }
import { ERROR_THEME, printTsinfraError } from "#report/errors.ts"
import { formatHostBlock, formatSummary } from "#report/format.ts"

const CHANGES_PENDING_EXIT_CODE = 2

/** Runs the hosts, prints each one's block and then the summary, and returns the exit code. */
const runTsinfra = async (): Promise<Result<number>> => {
  const config = run(program, { help: "option", version: packageJson.version, showDefault: true, theme: ERROR_THEME })

  const hostFiles = await discoverHosts(config.hostsDir, config.hosts)
  if (isErr(hostFiles)) return err("failed to discover hosts", hostFiles)

  const hostEntries = await loadHosts(hostFiles)
  if (isErr(hostEntries)) return hostEntries

  const hostReports: HostReport[] = []

  for (const hostEntry of hostEntries) {
    // oxlint-disable-next-line no-await-in-loop - hosts run one at a time until there's a parallel option
    const hostReport = await runHost(hostEntry, config.mode)
    hostReports.push(hostReport)

    const block = formatHostBlock(hostReport)
    if (block) console.log(`${block}\n`)
  }

  console.log(formatSummary(hostReports, config.mode))

  // Exit 1 for a failed host even when another has changes pending, because the plan is incomplete.
  if (hostReports.some(({ failure }) => failure)) return 1
  const hasChangesPending = hostReports.some(({ stepRecords }) => hasPendingChange(stepRecords))
  return config.mode === "plan" && hasChangesPending ? CHANGES_PENDING_EXIT_CODE : 0
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
