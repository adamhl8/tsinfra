import path from "node:path"

import { copyFixture, minimalEnv, packPackage, subprocessCoverageEnv } from "@adamhl8/configs/test"

const ROOT = path.resolve(import.meta.dir, "../../..")
const FIXTURE = path.resolve(import.meta.dir, "fixtures/project")

const HOST_SOURCE = `import { host } from "tsinfra"\n\nexport default host("@local", async () => {})\n`

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

/** Writes a host script named `<name>.ts` into `dir` that targets '@local' and runs `body` inside its function. */
export const writeLocalHost = async (dir: string, name: string, body: string) =>
  Bun.write(
    path.join(dir, `${name}.ts`),
    `import { host } from "tsinfra"\n\nexport default host("@local", async (h) => {\n${body}\n})\n`,
  )

/** Writes a host script for each name into `dir` that targets '@local' and does nothing. */
export const writeHosts = async (dir: string, names: string[]) => {
  await Promise.all(names.map(async (name) => Bun.write(path.join(dir, `${name}.ts`), HOST_SOURCE)))
}
