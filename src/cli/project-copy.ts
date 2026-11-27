import fs from "node:fs"
import path from "node:path"

import { type } from "arktype"
import bun from "bun"
import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

/** The copy of tsinfra installed in the project that the CLI runs in. */
interface ProjectCopy {
  cliPath: string
  packageJsonPath: string
  /** Whether the project's copy is the running copy, in which case it doesn't hand off. */
  isRunning: boolean
}

const packageVersionSchema = type({ version: "string" })

const NO_CLI_MESSAGE =
  "the project's copy of tsinfra has no 'tsinfra/cli' to start\nTry reinstalling it, or try updating both your global and local copies of tsinfra."

// Treat a copy as installed only when a `node_modules` is up the tree.
// Without one, Bun resolves a package by installing it from the registry.
const hasNodeModules = (dir: string): boolean => {
  if (fs.existsSync(path.join(dir, "node_modules"))) return true
  const parentDir = path.dirname(dir)
  return parentDir !== dir && hasNodeModules(parentDir)
}

/**
 * Finds the copy of tsinfra installed in the project at `cwd`, or `undefined` when there isn't one. Fails when the
 * project's copy has no `tsinfra/cli` to start, like a broken install or a copy from before the export.
 */
export const findProjectCopy = (cwd: string): Result<ProjectCopy | undefined> => {
  if (!hasNodeModules(cwd)) return undefined

  // Bun resolves `tsinfra/package.json` whether or not a copy's `exports` lists it.
  const packageJsonPath = attempt(() => bun.resolveSync("tsinfra/package.json", cwd))
  if (isErr(packageJsonPath)) return undefined

  // Replace Bun's error, because it says `Cannot find package 'tsinfra'` for a package it found.
  const cliPath = attempt(() => bun.resolveSync("tsinfra/cli", cwd))
  if (isErr(cliPath)) return err(NO_CLI_MESSAGE, undefined)

  // Resolve the running copy through its self-reference, so both paths come from the same resolver.
  const runningPackageJsonPath = attempt(() => bun.resolveSync("tsinfra/package.json", import.meta.dir))
  if (isErr(runningPackageJsonPath)) return err("failed to find the running copy of tsinfra", runningPackageJsonPath)

  return { cliPath, packageJsonPath, isRunning: packageJsonPath === runningPackageJsonPath }
}

/** Reads the version from the `package.json` at `packageJsonPath`. */
export const readPackageVersion = async (packageJsonPath: string): Promise<Result<string>> => {
  const packageJson = await attempt(async (): Promise<unknown> => bun.file(packageJsonPath).json())
  if (isErr(packageJson)) return err(`failed to read '${packageJsonPath}'`, packageJson)

  const validPackageJson = packageVersionSchema(packageJson)
  if (validPackageJson instanceof type.errors)
    return err(`failed to read '${packageJsonPath}'`, err(validPackageJson.summary, undefined))

  return validPackageJson.version
}
