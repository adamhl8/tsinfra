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
    expect(stderr).toStartWith("Error: failed to discover hosts -> failed to read hosts directory 'nowhere' -> ENOENT")
  })

  it("should print the error and exit 1 when a host can't be loaded", async () => {
    const { dir, run } = await createProject()
    await Bun.write(path.join(dir, "hosts", "a.ts"), "")

    const { stdout, stderr, exitCode } = await run`tsinfra plan`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toBe(
      "Error: failed to load hosts:\nfailed to load host 'a' -> default must be an object (was missing)",
    )
  })

  it("should print a failed host's error in its block on stdout and exit 1", async () => {
    const { dir, run } = await createProject()
    await writeHosts(path.join(dir, "hosts"), ["a"])
    const source = `import { host } from "tsinfra"\n\nexport default host("b.lan", async () => { throw new Error("boom") })\n`
    await Bun.write(path.join(dir, "hosts", "b.ts"), source)

    const { stdout, stderr, exitCode } = await run`tsinfra plan`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe("b\n  ! b.ts\n      boom\n\na   unchanged\nb   failed")
    expect(stderr).toBe("")
  })

  // Write the host file as a string, because Bun runs host files without type-checking them.
  it("should fail a step whose want is neither a string nor a boolean", async () => {
    const { dir, run } = await createProject()
    await writeLocalHost(
      path.join(dir, "hosts"),
      "a",
      `await h.ensure("Bad want", { check: "true", want: 1, fix: "true" })`,
    )

    const { stdout, exitCode } = await run`tsinfra plan`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe(
      "a\n  ! Bad want\n      failed to read the host's state for step 'Bad want' -> want must be a string or a boolean, but is a number\n\na   failed",
    )
  })

  it("should fail a run that has no after", async () => {
    const { dir, run } = await createProject()
    await writeLocalHost(path.join(dir, "hosts"), "a", `await h.run("Bad run", "true", {})`)

    const { stdout, exitCode } = await run`tsinfra plan`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe(
      "a\n  ! Bad run\n      failed to run step 'Bad run' -> after must be an array or \"always\" (was missing)\n\na   failed",
    )
  })

  it("should fail a run whose after holds something other than step results", async () => {
    const { dir, run } = await createProject()
    await writeLocalHost(path.join(dir, "hosts"), "a", `await h.run("Bad run", "true", { after: [undefined] })`)

    const { stdout, exitCode } = await run`tsinfra plan`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe(
      "a\n  ! Bad run\n      failed to run step 'Bad run' -> after[0] must be an object (was undefined)\n\na   failed",
    )
  })

  it("should run a host that reads from '@local'", async () => {
    const { dir, run } = await createProject()
    const source = `import { host } from "tsinfra"\n\nexport default host("@local", async (h) => console.log(await h.read("echo hi")))\n`
    await Bun.write(path.join(dir, "hosts", "a.ts"), source)

    const { stdout, exitCode } = await run`tsinfra plan`.nothrow()

    expect(exitCode).toBe(0)
    expect(stdout).toBe("hi\na   unchanged")
  })

  it("should only run a step's fix in apply", async () => {
    const { dir, run } = await createProject()
    const marker = path.join(dir, "marker")
    const step = `h.ensure("Make marker", { check: "test -f '${marker}'", want: true, fix: "touch '${marker}'" })`
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
    await writeLocalHost(path.join(dir, "hosts"), "a", `await h.run("Prune", "true", { after: "always" })`)

    expect((await run`tsinfra plan`.nothrow()).exitCode).toBe(0)
  })

  it("should exit 1 from plan when a host fails, even with changes pending on another", async () => {
    const { dir, run } = await createProject()
    const hostsDir = path.join(dir, "hosts")
    await writeLocalHost(hostsDir, "a", `await h.ensure("Pending", { check: "false", want: true, fix: "true" })`)
    await writeLocalHost(hostsDir, "b", `await h.read("exit 1")`)

    expect((await run`tsinfra plan`.nothrow()).exitCode).toBe(1)
  })

  it("should print a block for each host with something to show, then the summary", async () => {
    const { dir, run } = await createProject()
    const hostsDir = path.join(dir, "hosts")
    const steps = [
      `await h.ensure("Write the unit", { check: "false", want: true, fix: "true" })`,
      `await h.run("Reload systemd", "true", { after: "always" })`,
    ]
    await writeLocalHost(hostsDir, "sonarr", steps.join("\n"))
    await writeLocalHost(hostsDir, "caddy", `await h.read("true")`)

    const { stdout, stderr } = await run`tsinfra plan`.nothrow()

    expect(stdout).toBe(
      [
        "sonarr",
        "  ~ Write the unit",
        "  > Reload systemd",
        "",
        "Steps after a change were checked without that change, so apply may differ.",
        "",
        "caddy    unchanged",
        "sonarr   2 changes",
      ].join("\n"),
    )
    expect(stderr).toBe("")
  })
})
