#!/usr/bin/env bun
import process from "node:process"

import { run } from "@optique/run"
import type { Result } from "ts-explicit-errors"
import { err, isErr, messageChain } from "ts-explicit-errors"

import { program } from "#cli/program.ts"
import { discoverHosts } from "#hosts/discover.ts"
import packageJson from "#package.json" with { type: "json" }

const runTsinfra = async (): Promise<Result> => {
  const config = run(program, { help: "option", version: packageJson.version, showDefault: true })

  const hosts = await discoverHosts(config.hostsDir, config.hosts)
  if (isErr(hosts)) return err("failed to discover hosts", hosts)

  for (const { name } of hosts) console.log(name)
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
