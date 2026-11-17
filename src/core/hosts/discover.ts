import { Glob } from "bun"
import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

const HOST_SCRIPT_EXTENSION = ".ts"

/** Lists the host scripts directly inside `dir`, sorted, as absolute paths. */
export const discoverHostScripts = async (dir: string): Promise<Result<string[]>> => {
  const glob = new Glob(`*${HOST_SCRIPT_EXTENSION}`)
  const files = await attempt(async () => Array.fromAsync(glob.scan({ cwd: dir, absolute: true })))
  if (isErr(files)) return err(`failed to read hosts directory '${dir}'`, files)
  if (files.length === 0) return err(`no host scripts in '${dir}'`, undefined)

  return files.toSorted()
}
