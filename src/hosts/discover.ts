import path from "node:path"

import { Glob } from "bun"
import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

export const HOST_FILE_EXTENSION = ".ts"

export interface HostFile {
  name: string
  file: string
}

/** Wraps each name in single quotes and joins them into a list. */
const quoteNames = (names: Iterable<string>) => Array.from(names, (name) => `'${name}'`).join(", ")

/** Lists the host files directly inside `dir`, narrowed to `names` when any are given. */
export const discoverHosts = async (dir: string, names: readonly string[]): Promise<Result<HostFile[]>> => {
  const glob = new Glob(`*${HOST_FILE_EXTENSION}`)
  const files = await attempt(async () => Array.fromAsync(glob.scan({ cwd: dir, absolute: true })))
  if (isErr(files)) return err(`failed to read hosts directory '${dir}'`, files)

  const hostFiles: HostFile[] = files
    .toSorted()
    .map((file) => ({ name: path.basename(file, HOST_FILE_EXTENSION), file }))
  if (hostFiles.length === 0) return err(`no host files in '${dir}'`, undefined)
  if (names.length === 0) return hostFiles

  const hostNames = new Set(hostFiles.map(({ name }) => name))
  const unknownNames = names.filter((name) => !hostNames.has(name))
  if (unknownNames.length > 0)
    return err(`unknown host ${quoteNames(unknownNames)} (hosts: ${quoteNames(hostNames)})`, undefined)

  const selectedNames = new Set(names)
  return hostFiles.filter(({ name }) => selectedNames.has(name))
}
