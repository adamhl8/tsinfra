import path from "node:path"

import { copyFixture, minimalEnv, packPackage } from "@adamhl8/configs/test"

const ROOT = path.resolve(import.meta.dir, "../../..")
const FIXTURE = path.resolve(import.meta.dir, "fixtures/project")

/** Copies the fixture into a temp dir, installs the packed tsinfra, and returns the dir and a shell bound to it. */
export const createProject = async () => {
  const { dir, run } = await copyFixture(FIXTURE, { shell: { env: minimalEnv() } })
  await run`bun add -d ${await packPackage(ROOT)}`

  return { dir, run }
}
