import path from "node:path"

import { copyFixture, minimalEnv, packPackage, subprocessCoverageEnv } from "@adamhl8/configs/test"

const ROOT = path.resolve(import.meta.dir, "../../..")
const FIXTURE = path.resolve(import.meta.dir, "fixtures/project")

let tarball: Promise<string> | undefined
/** Builds and packs tsinfra on first use, so concurrent tests share one tarball. */
const packTsinfra = async () => {
  tarball ??= packPackage(ROOT)
  return tarball
}

/** Copies the fixture into a temp dir, installs the packed tsinfra, and returns the dir and a shell bound to it. */
export const createProject = async () => {
  const { dir, run } = await copyFixture(FIXTURE, { shell: { env: minimalEnv(subprocessCoverageEnv()) } })
  await run`bun add -d ${await packTsinfra()}`

  return { dir, run }
}
