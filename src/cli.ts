#!/usr/bin/env bun
import process from "node:process"

import { run } from "@optique/run"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { program } from "#cli/program.ts"
import { discoverHostScripts } from "#core/hosts/discover.ts"
import { loadHosts, selectHosts } from "#core/hosts/load.ts"
import { prepareHosts } from "#core/hosts/prepare.ts"
import { runHost } from "#core/hosts/run.ts"
import { closeConnections } from "#core/transport.ts"
import packageJson from "#package.json" with { type: "json" }
import { renderHostBlock } from "#report.ts"
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

  const hostEntries = await prepareHosts(selectedHosts)

  const reportOptions = { verbosity: config.verbosity }
  const hostBlocks: HostBlock[] = []

  for (const hostEntry of hostEntries) {
    // oxlint-disable-next-line no-await-in-loop - hosts run one at a time until there's a parallel option
    const hostRecord = await runHost(hostEntry, config.mode)
    const hostBlock = toHostBlock(hostRecord)
    hostBlocks.push(hostBlock)

    const renderedHostBlock = renderHostBlock(hostBlock, reportOptions)
    if (renderedHostBlock) console.log(`${renderedHostBlock}\n`)
  }

  await closeConnections(selectedHosts.map(({ target }) => target))

  console.log(renderSummary(hostBlocks, config.mode))

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
