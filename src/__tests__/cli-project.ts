import fs from "node:fs/promises"
import path from "node:path"

import { copyFixture, makeTempDir, minimalEnv } from "@adamhl8/configs/test"
import bun from "bun"

const ROOT = path.resolve(import.meta.dir, "../..")
const FIXTURE = path.resolve(import.meta.dir, "fixtures/project")

/**
 * Copies the fixture into a temp dir with the packed tsinfra installed. Returns the dir, the `env` to run tsinfra with,
 * and a shell bound to both. `env` has a temp `HOME`, so each project keeps its saved state apart from the real home's
 * and from every other test's.
 */
export const createProject = async () => {
  const env = minimalEnv({ HOME: await makeTempDir() })
  const { dir, run } = await copyFixture(FIXTURE, { packageRoot: ROOT, shell: { env } })

  return { dir, env, run }
}

/** Returns the path of the project's installed tsinfra bin, which stands in for a global copy in another project. */
export const getInstalledBin = (dir: string) => path.join(dir, "node_modules/.bin/tsinfra")

const getInstalledPath = (dir: string, relativePath: string) => path.join(dir, "node_modules/tsinfra", relativePath)

/** Replaces a file in the project's installed tsinfra. */
export const replaceInstalledFile = async (dir: string, relativePath: string, content: string) => {
  await bun.write(getInstalledPath(dir, relativePath), content)
}

/** Removes a file from the project's installed tsinfra. */
export const removeInstalledFile = async (dir: string, relativePath: string) => {
  await fs.rm(getInstalledPath(dir, relativePath))
}
