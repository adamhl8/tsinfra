import fs from "node:fs/promises"
import path from "node:path"

import { copyFixture, minimalEnv, packPackage } from "@adamhl8/configs/test"
import bun from "bun"

const ROOT = path.resolve(import.meta.dir, "../..")
const FIXTURE = path.resolve(import.meta.dir, "fixtures/project")

/** Copies the fixture into a temp dir, installs the packed tsinfra, and returns the dir and a shell bound to it. */
export const createProject = async () => {
  const { dir, run } = await copyFixture(FIXTURE, { shell: { env: minimalEnv() } })
  await run`bun add -d ${await packPackage(ROOT)}`

  return { dir, run }
}

/** Returns the path of the project's installed tsinfra bin, which stands in for a global copy in another project. */
export const getInstalledBin = (dir: string) => path.join(dir, "node_modules/.bin/tsinfra")

/**
 * Replaces a file in the project's installed tsinfra by renaming a new file over it. Bun hardlinks installs from its
 * cache on Linux, so writing the file in place would change the cache too.
 */
export const replaceInstalledFile = async (dir: string, relativePath: string, content: string) => {
  const packageDir = await fs.realpath(path.join(dir, "node_modules/tsinfra"))
  const filePath = path.join(packageDir, relativePath)
  const tempPath = `${filePath}.tmp`
  await bun.write(tempPath, content)
  await fs.rename(tempPath, filePath)
}
