#!/usr/bin/env bun
import process from "node:process"

import { isErr } from "ts-explicit-errors"

import { parseCommandLine } from "#cli/program.ts"
import { printTsinfraError } from "#report/errors.ts"

const main = async (): Promise<number> => {
  const commandLine = parseCommandLine()

  // Import `#cli/run.ts` only once there's a command to run, so this file loads none of tsinfra's core before then.
  const { runTsinfra } = await import("#cli/run.ts")
  const exitCode = await runTsinfra(commandLine)
  if (isErr(exitCode)) {
    printTsinfraError(exitCode)
    return 1
  }

  return exitCode
}

process.exitCode = await main()
