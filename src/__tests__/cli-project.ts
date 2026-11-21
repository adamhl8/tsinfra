import fs from "node:fs/promises"
import path from "node:path"

import { copyFixture, makeTempDir, minimalEnv, packPackage } from "@adamhl8/configs/test"
import bun from "bun"

const ROOT = path.resolve(import.meta.dir, "../..")
const FIXTURE = path.resolve(import.meta.dir, "fixtures/project")

/**
 * Copies the fixture into a temp dir and installs the packed tsinfra. Returns the dir, the `env` to run tsinfra with,
 * and a shell bound to both. `env` has a temp `HOME`, so each project keeps its saved state apart from the real home's
 * and from every other test's.
 */
export const createProject = async () => {
  const env = minimalEnv({ HOME: await makeTempDir() })
  const { dir, run } = await copyFixture(FIXTURE, { shell: { env } })
  // Install with the real `HOME`, because Bun's install cache is there.
  await run`bun add -d ${await packPackage(ROOT)}`.env(minimalEnv())

  return { dir, env, run }
}

/** Returns the path of the project's installed tsinfra bin, which stands in for a global copy in another project. */
export const getInstalledBin = (dir: string) => path.join(dir, "node_modules/.bin/tsinfra")

/** Returns the real path of a file in the project's installed tsinfra, through the `node_modules` symlink. */
const getInstalledPath = async (dir: string, relativePath: string) => {
  const packageDir = await fs.realpath(path.join(dir, "node_modules/tsinfra"))
  return path.join(packageDir, relativePath)
}

/**
 * Replaces a file in the project's installed tsinfra by renaming a new file over it. Bun hardlinks installs from its
 * cache on Linux, so writing the file in place would change the cache too.
 */
export const replaceInstalledFile = async (dir: string, relativePath: string, content: string) => {
  const filePath = await getInstalledPath(dir, relativePath)
  const tempPath = `${filePath}.tmp`
  await bun.write(tempPath, content)
  await fs.rename(tempPath, filePath)
}

/** Removes a file from the project's installed tsinfra, which leaves any cache copy Bun hardlinked it from. */
export const removeInstalledFile = async (dir: string, relativePath: string) => {
  await fs.rm(await getInstalledPath(dir, relativePath))
}
