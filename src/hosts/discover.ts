import path from "node:path"

import { Glob } from "bun"
import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import { quoteNames } from "#utils.ts"

export const HOST_SCRIPT_EXTENSION = ".ts"

export interface HostScript {
  name: string
  file: string
}

/** Lists the host scripts directly inside `dir`, narrowed to `names` when any are given. */
export const discoverHosts = async (dir: string, names: readonly string[]): Promise<Result<HostScript[]>> => {
  const glob = new Glob(`*${HOST_SCRIPT_EXTENSION}`)
  const files = await attempt(async () => Array.fromAsync(glob.scan({ cwd: dir, absolute: true })))
  if (isErr(files)) return err(`failed to read hosts directory '${dir}'`, files)

  const hostScripts: HostScript[] = files
    .toSorted()
    .map((file) => ({ name: path.basename(file, HOST_SCRIPT_EXTENSION), file }))
  if (hostScripts.length === 0) return err(`no host scripts in '${dir}'`, undefined)
  if (names.length === 0) return hostScripts

  const hostNames = new Set(hostScripts.map(({ name }) => name))
  const unknownNames = names.filter((name) => !hostNames.has(name))
  if (unknownNames.length > 0)
    return err(`unknown host ${quoteNames(unknownNames)} (hosts: ${quoteNames(hostNames)})`, undefined)

  const selectedNames = new Set(names)
  return hostScripts.filter(({ name }) => selectedNames.has(name))
}
