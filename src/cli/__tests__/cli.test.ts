import { describe, expect, it, setDefaultTimeout } from "bun:test"
import path from "node:path"

import { writeHosts } from "#__tests__/utils.ts"
import { createProject } from "#cli/__tests__/utils.ts"

setDefaultTimeout(30_000)

describe("tsinfra", () => {
  it.each(["plan", "apply"])("should run %s", async (command) => {
    const { dir, run } = await createProject()
    await writeHosts(path.join(dir, "hosts"), ["a"])

    const { exitCode } = await run`tsinfra ${command}`.nothrow()

    expect(exitCode).toBe(0)
  })

  it("should exit 1 on a usage error", async () => {
    const { run } = await createProject()

    const { exitCode } = await run`tsinfra nope`.nothrow()

    expect(exitCode).toBe(1)
  })

  it("should print the error and exit 1 when the hosts can't be discovered", async () => {
    const { run } = await createProject()

    const { stdout, stderr, exitCode } = await run`tsinfra plan --hosts-dir nowhere`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toStartWith("failed to discover hosts -> failed to read hosts directory 'nowhere' -> ENOENT")
  })
})
