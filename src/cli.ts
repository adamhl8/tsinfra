#!/usr/bin/env bun
import process from "node:process"

import { run } from "@optique/run"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { program } from "#cli/program.ts"
import { clearProgress, formatPreparingProgress, printProgress, showHostProgress } from "#cli/progress.ts"
import { discoverHostScripts } from "#core/hosts/discover.ts"
import { loadHosts, selectHosts } from "#core/hosts/load.ts"
import { finishHosts, initializeHosts } from "#core/hosts/prepare.ts"
import { runHost } from "#core/hosts/run.ts"
import { closeConnections } from "#core/transport.ts"
import packageJson from "#package.json" with { type: "json" }
import { renderHostBlock, toShownHostBlock } from "#report.ts"
import { ERROR_THEME, printTsinfraError } from "#report/errors.ts"
import { getExitCode } from "#report/exit-code.ts"
import type { HostBlock } from "#report/host-block.ts"
import { toHostBlock } from "#report/host-block.ts"
import { renderSummary } from "#report/summary.ts"

/** Runs the hosts, prints each one's host block and then the summary, and returns the exit code. */
const runTsinfra = async (): Promise<Result<number>> => {
  const config = run(program, { help: "option", version: packageJson.version, showDefault: true, theme: ERROR_THEME })

  const hostScripts = await discoverHostScripts(config.hostsDir)
  if (isErr(hostScripts)) return err("failed to discover hosts", hostScripts)

  const loadedHosts = await loadHosts(hostScripts)
  if (isErr(loadedHosts)) return loadedHosts

  const selectedHosts = selectHosts(loadedHosts, config.hosts)
  if (isErr(selectedHosts)) return err("failed to pick hosts", selectedHosts)

  printProgress(formatPreparingProgress(selectedHosts.length))
  const hostInitializations = await initializeHosts(selectedHosts)
  // Clear the progress line before finishing, because a sudo password prompt can start there.
  clearProgress()

  const hostEntries = await finishHosts(hostInitializations)

  const reportOptions = { verbosity: config.verbosity }
  const hostBlocks: HostBlock[] = []
  const shownHostBlocks: HostBlock[] = []

  for (const hostEntry of hostEntries) {
    const stopHostProgress = showHostProgress(hostEntry.hostRecord, config.mode)
    // oxlint-disable-next-line no-await-in-loop - hosts run one at a time until there's a parallel option
    const hostRecord = await runHost(hostEntry, config.mode)
    stopHostProgress()

    const hostBlock = toHostBlock(hostRecord, config.mode)
    hostBlocks.push(hostBlock)

    const shownHostBlock = toShownHostBlock(hostBlock, config.verbosity)
    shownHostBlocks.push(shownHostBlock)

    const renderedHostBlock = renderHostBlock(shownHostBlock, reportOptions)
    if (renderedHostBlock) console.log(`${renderedHostBlock}\n`)
  }

  await closeConnections(selectedHosts.map(({ target }) => target))

  console.log(renderSummary(shownHostBlocks, config.mode))

  // Use every host's full block, because the exit code says whether the host drifted, whatever the report shows.
  return getExitCode(hostBlocks, config.mode)
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
