import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { CommandLine } from "#cli/program.ts"
import { clearProgress, formatPreparingProgress, printProgress, showHostProgress } from "#cli/progress.ts"
import { discoverHostScripts } from "#core/hosts/discover.ts"
import { loadHosts, selectHosts } from "#core/hosts/load.ts"
import { finishHosts, initializeHosts } from "#core/hosts/prepare.ts"
import { runHost } from "#core/hosts/run.ts"
import { closeConnections } from "#core/transport.ts"
import { renderHostBlock, toShownHostBlock } from "#report.ts"
import { getExitCode } from "#report/exit-code.ts"
import type { HostBlock } from "#report/host-block.ts"
import { toHostBlock } from "#report/host-block.ts"
import { renderSummary } from "#report/summary.ts"

/** Runs the hosts, prints each one's host block and then the summary, and returns the exit code. */
export const runTsinfra = async (commandLine: CommandLine): Promise<Result<number>> => {
  const hostScripts = await discoverHostScripts(commandLine.hostsDir)
  if (isErr(hostScripts)) return err("failed to discover hosts", hostScripts)

  const loadedHosts = await loadHosts(hostScripts)
  if (isErr(loadedHosts)) return loadedHosts

  const selectedHosts = selectHosts(loadedHosts, commandLine.hosts)
  if (isErr(selectedHosts)) return err("failed to pick hosts", selectedHosts)

  printProgress(formatPreparingProgress(selectedHosts.length))
  const hostInitializations = await initializeHosts(selectedHosts)
  // Clear the progress line before finishing, because a sudo password prompt can start there.
  clearProgress()

  const hostEntries = await finishHosts(hostInitializations)

  const reportOptions = { verbosity: commandLine.verbosity }
  const hostBlocks: HostBlock[] = []
  const shownHostBlocks: HostBlock[] = []

  for (const hostEntry of hostEntries) {
    const stopHostProgress = showHostProgress(hostEntry.hostRecord, commandLine.mode)
    // oxlint-disable-next-line no-await-in-loop - hosts run one at a time until there's a parallel option
    const hostRecord = await runHost(hostEntry, commandLine.mode)
    stopHostProgress()

    const hostBlock = toHostBlock(hostRecord, commandLine.mode)
    hostBlocks.push(hostBlock)

    const shownHostBlock = toShownHostBlock(hostBlock, commandLine.verbosity)
    shownHostBlocks.push(shownHostBlock)

    const renderedHostBlock = renderHostBlock(shownHostBlock, reportOptions)
    if (renderedHostBlock) console.log(`${renderedHostBlock}\n`)
  }

  await closeConnections(selectedHosts.map(({ target }) => target))

  console.log(renderSummary(shownHostBlocks, commandLine.mode))

  // Use every host's full block, because the exit code says whether the host drifted, whatever the report shows.
  return getExitCode(hostBlocks, commandLine.mode)
}
