import path from "node:path"

import { Glob } from "bun"
import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

export interface HostFile {
  name: string
  file: string
}

/** Lists the host files directly inside `dir`, narrowed to `names` when any are given. */
export const discoverHosts = async (dir: string, names: readonly string[]): Promise<Result<HostFile[]>> => {
  const files = await attempt(async () => Array.fromAsync(new Glob("*.ts").scan({ cwd: dir, absolute: true })))
  if (isErr(files)) return err(`failed to read hosts directory '${dir}'`, files)

  const hosts = files.toSorted().map((file) => ({ name: path.basename(file, ".ts"), file }))
  if (hosts.length === 0) return err(`no host files in '${dir}'`, undefined)
  if (names.length === 0) return hosts

  const hostNames = new Set(hosts.map(({ name }) => name))
  const unknownNames = names.filter((name) => !hostNames.has(name))
  if (unknownNames.length > 0)
    return err(`unknown host: ${unknownNames.join(", ")} (hosts: ${[...hostNames].join(", ")})`, undefined)

  const selectedNames = new Set(names)
  return hosts.filter(({ name }) => selectedNames.has(name))
}
