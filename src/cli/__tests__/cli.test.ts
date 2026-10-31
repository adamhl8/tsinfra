import { describe, expect, it, setDefaultTimeout } from "bun:test"
import path from "node:path"

import { createProject, writeHosts, writeLocalHost } from "#cli/__tests__/utils.ts"

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

  it("should print the error and exit 1 when a host can't be loaded", async () => {
    const { dir, run } = await createProject()
    await Bun.write(path.join(dir, "hosts", "a.ts"), "")

    const { stdout, stderr, exitCode } = await run`tsinfra plan`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toBe("failed to load hosts:\nfailed to load host 'a' -> default must be an object (was missing)")
  })

  it("should print the error and exit 1 when a host fails", async () => {
    const { dir, run } = await createProject()
    await writeHosts(path.join(dir, "hosts"), ["a"])
    const source = `import { host } from "tsinfra"\n\nexport default host("b.lan", async () => { throw new Error("boom") })\n`
    await Bun.write(path.join(dir, "hosts", "b.ts"), source)

    const { stdout, stderr, exitCode } = await run`tsinfra plan`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe("a ok")
    expect(stderr).toBe("failed to run host 'b' -> boom")
  })

  it("should run a host that reads from '@local'", async () => {
    const { dir, run } = await createProject()
    const source = `import { host } from "tsinfra"\n\nexport default host("@local", async (h) => console.log(await h.read("echo hi")))\n`
    await Bun.write(path.join(dir, "hosts", "a.ts"), source)

    const { stdout, exitCode } = await run`tsinfra plan`.nothrow()

    expect(exitCode).toBe(0)
    expect(stdout).toBe("hi\na ok")
  })

  it("should only run a step's fix in apply", async () => {
    const { dir, run } = await createProject()
    const marker = path.join(dir, "marker")
    const step = `h.ensure("Make marker", { check: "test -f '${marker}'", fix: "touch '${marker}'" })`
    await Bun.write(
      path.join(dir, "hosts", "a.ts"),
      `import { host } from "tsinfra"\n\nexport default host("@local", async (h) => void (await ${step}))\n`,
    )

    expect((await run`tsinfra plan`.nothrow()).exitCode).toBe(2)
    expect(await Bun.file(marker).exists()).toBe(false)

    expect((await run`tsinfra apply`.nothrow()).exitCode).toBe(0)
    expect(await Bun.file(marker).exists()).toBe(true)
  })

  it("should exit 0 from plan when the only thing pending is a run", async () => {
    const { dir, run } = await createProject()
    await writeLocalHost(path.join(dir, "hosts"), "a", `await h.run("Prune", "true", { when: true })`)

    expect((await run`tsinfra plan`.nothrow()).exitCode).toBe(0)
  })

  it("should exit 1 from plan when a host fails, even with changes pending on another", async () => {
    const { dir, run } = await createProject()
    const hostsDir = path.join(dir, "hosts")
    await writeLocalHost(hostsDir, "a", `await h.ensure("Pending", { check: "false", fix: "true" })`)
    await writeLocalHost(hostsDir, "b", `await h.read("exit 1")`)

    expect((await run`tsinfra plan`.nothrow()).exitCode).toBe(1)
  })
})
