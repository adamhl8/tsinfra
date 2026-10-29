#!/usr/bin/env bun
import process from "node:process"

import { run } from "@optique/run"
import type { Result } from "ts-explicit-errors"
import { err, isErr, messageChain } from "ts-explicit-errors"

import { program } from "#cli/program.ts"
import { discoverHosts } from "#hosts/discover.ts"
import { loadHosts } from "#hosts/load.ts"
import packageJson from "#package.json" with { type: "json" }

const runTsinfra = async (): Promise<Result> => {
  const config = run(program, { help: "option", version: packageJson.version, showDefault: true })

  const hostFiles = await discoverHosts(config.hostsDir, config.hosts)
  if (isErr(hostFiles)) return err("failed to discover hosts", hostFiles)

  const hosts = await loadHosts(hostFiles)
  if (isErr(hosts)) return hosts

  for (const { name, target } of hosts) console.log(`${name} -> ${target}`)
}

const main = async (): Promise<number> => {
  const result = await runTsinfra()
  if (isErr(result)) {
    console.error(messageChain(result))
    return 1
  }

  return 0
}

process.exitCode = await main()
