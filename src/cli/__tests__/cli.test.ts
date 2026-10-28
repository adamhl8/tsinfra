import { expect, it, setDefaultTimeout } from "bun:test"
import path from "node:path"

import { createProject, writeHosts } from "#cli/__tests__/utils.ts"

setDefaultTimeout(30_000)

it.each(["plan", "apply"])("runs %s", async (command) => {
  const { dir, run } = await createProject()
  await writeHosts(path.join(dir, "hosts"), ["a"])

  const { exitCode } = await run`tsinfra ${command}`.nothrow()

  expect(exitCode).toBe(0)
})

it("exits 1 on a usage error", async () => {
  const { run } = await createProject()

  const { exitCode } = await run`tsinfra nope`.nothrow()

  expect(exitCode).toBe(1)
})
