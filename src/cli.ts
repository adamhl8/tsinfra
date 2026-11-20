#!/usr/bin/env bun
import process from "node:process"

import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { isVersionRequest, parseCommandLine } from "#cli/program.ts"
import { findProjectCopy, readPackageVersion } from "#cli/project-copy.ts"
import packageJson from "#package.json" with { type: "json" }
import { printTsinfraError } from "#report/errors.ts"

const NOT_INSTALLED_MESSAGE =
  'tsinfra isn\'t installed in this project\nAdd it with `bun add --dev tsinfra`, because host scripts import "tsinfra".'

/** Hands off to the project's copy of tsinfra, or runs the hosts and returns the exit code. */
const runCli = async (): Promise<Result<number | undefined>> => {
  const projectCopy = findProjectCopy(process.cwd())
  if (isErr(projectCopy)) return projectCopy

  const runningCopy = projectCopy?.isRunning ? "project" : "global"

  if (projectCopy && runningCopy === "global") {
    // Answer a version request here, because only the launcher knows both copies' versions.
    // Ask its own Optique only about the version, so the project's copy still answers help and usage errors.
    if (isVersionRequest()) {
      const projectVersion = await readPackageVersion(projectCopy.packageJsonPath)
      if (isErr(projectVersion)) return projectVersion
      console.log(`${projectVersion} (project)\n${packageJson.version} (global)`)
      return 0
    }

    // Leave `import` unwrapped, because the project's copy runs its whole CLI as it loads.
    // A crash there then looks the same as when that copy is started directly.
    await import(projectCopy.cliPath)
    return undefined
  }

  // Parse before checking for the project's copy, so help, the version, and usage errors work outside a project.
  const commandLine = parseCommandLine(runningCopy)
  if (!projectCopy) return err(NOT_INSTALLED_MESSAGE, undefined)

  // Import `#cli/run.ts` only once there's a command to run, so this file loads none of tsinfra's core before then.
  const { runTsinfra } = await import("#cli/run.ts")
  return runTsinfra(commandLine)
}

const main = async (): Promise<void> => {
  const exitCode = await runCli()
  if (isErr(exitCode)) {
    printTsinfraError(exitCode)
    process.exitCode = 1
    return
  }

  // Leave `process.exitCode` alone after a hand-off, because the project's copy sets its own.
  if (exitCode !== undefined) process.exitCode = exitCode
}

await main()
