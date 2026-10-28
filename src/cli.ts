#!/usr/bin/env bun
import process from "node:process"

import { run } from "@optique/run"
import { isErr, messageChain } from "ts-explicit-errors"

import { program } from "#cli/program.ts"
import { discoverHosts } from "#hosts/discover.ts"

const main = async (): Promise<number> => {
  const config = run(program, { help: "option", version: program.metadata.version ?? "", showDefault: true })

  const hosts = await discoverHosts(config.hostsDir, config.hosts)
  if (isErr(hosts)) {
    console.error(`error: ${messageChain(hosts)}`)
    return 1
  }

  for (const { name } of hosts) console.log(name)
  return 0
}

process.exitCode = await main()
