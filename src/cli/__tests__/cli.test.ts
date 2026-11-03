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
    const source = `import { host } from "tsinfra"\n\nexport default host("@local", async () => { throw new Error("boom") })\n`
    await Bun.write(path.join(dir, "hosts", "b.ts"), source)

    const { stdout, stderr, exitCode } = await run`tsinfra plan`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe("b\n  ! b.ts\n      boom\n\na   unchanged\nb   failed")
    expect(stderr).toBe("")
  })

  // Write the host script as a string, because Bun runs host scripts without type-checking them.
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
      "a\n  ! Bad want\n      failed to validate the options given to step 'Bad want' -> want must be a string or boolean (was a number)\n\na   failed",
    )
  })

  it("should fail a run that has no after", async () => {
    const { dir, run } = await createProject()
    await writeLocalHost(path.join(dir, "hosts"), "a", `await h.run("Bad run", "true", {})`)

    const { stdout, exitCode } = await run`tsinfra plan`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe(
      "a\n  ! Bad run\n      failed to validate the options given to step 'Bad run' -> after must be an array or \"always\" (was missing)\n\na   failed",
    )
  })

  it("should fail a run whose after holds something other than step results", async () => {
    const { dir, run } = await createProject()
    await writeLocalHost(path.join(dir, "hosts"), "a", `await h.run("Bad run", "true", { after: [undefined] })`)

    const { stdout, exitCode } = await run`tsinfra plan`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe(
      "a\n  ! Bad run\n      failed to validate the options given to step 'Bad run' -> after[0] must be an object (was undefined)\n\na   failed",
    )
  })

  it("should fail a run that follows a step that can't change the host", async () => {
    const { dir, run } = await createProject()
    const body = `await h.run("Bad run", "true", { after: [{ name: "uname -m", kind: "read", changed: false }] })`
    await writeLocalHost(path.join(dir, "hosts"), "a", body)

    const { stdout, exitCode } = await run`tsinfra plan`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe(
      'a\n  ! Bad run\n      failed to validate the options given to step \'Bad run\' -> after[0].kind must be "ensure", "file" or "run" (was "read")\n\na   failed',
    )
  })

  it("should fail a step whose needs holds something other than step results", async () => {
    const { dir, run } = await createProject()
    await writeLocalHost(
      path.join(dir, "hosts"),
      "a",
      `await h.ensure("Bad needs", { needs: [undefined], check: "true", want: true, fix: "true" })`,
    )

    const { stdout, exitCode } = await run`tsinfra plan`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe(
      "a\n  ! Bad needs\n      failed to validate the options given to step 'Bad needs' -> needs[0] must be an object (was undefined)\n\na   failed",
    )
  })

  it("should fail a step that needs a run", async () => {
    const { dir, run } = await createProject()
    const body = [
      `const prune = await h.run("Prune", "true", { after: "always" })`,
      `await h.ensure("Bad needs", { needs: [prune], check: "true", want: true, fix: "true" })`,
    ].join("\n")
    await writeLocalHost(path.join(dir, "hosts"), "a", body)

    const { stdout, exitCode } = await run`tsinfra plan`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe(
      'a\n  > Prune\n  ! Bad needs\n      failed to validate the options given to step \'Bad needs\' -> needs[0].kind must be "ensure" or "file" (was "run")\n\na   failed',
    )
  })

  it.each([
    {
      description: "an ensure whose fix is an empty command",
      command: "plan",
      body: `await h.ensure("Bad fix", { check: "true", want: true, fix: "" })`,
      expected:
        "a\n  ! Bad fix\n      failed to validate the options given to step 'Bad fix' -> fix must be non-empty\n\na   failed",
    },
    {
      description: "a file whose content is neither a string nor bytes",
      command: "plan",
      body: `await h.file("/tmp/x", { content: 1 })`,
      expected:
        "a\n  ! /tmp/x\n      failed to validate the options given to step '/tmp/x' -> content must be a string or an object (was a number)\n\na   failed",
    },
    {
      description: "a step with an empty name",
      command: "plan",
      body: `await h.ensure("", { check: "true", want: true, fix: "true" })`,
      expected: "a\n  ! a.ts\n      failed to validate the name given to 'ensure' -> must be non-empty\n\na   failed",
    },
    {
      description: "a read whose command isn't a string",
      command: "plan",
      body: `await h.read(1)`,
      expected:
        "a\n  ! a.ts\n      failed to validate the command given to 'read' -> must be a string (was a number)\n\na   failed",
    },
    {
      description: "a run whose command is neither a string nor a function",
      command: "plan",
      body: `await h.run("Bad run", 1, { after: "always" })`,
      expected:
        "a\n  ! Bad run\n      failed to validate the command given to step 'Bad run' -> must be a string or an object (was a number)\n\na   failed",
    },
    {
      description: "a fix that execs an empty command",
      command: "apply",
      body: `await h.ensure("Bad exec", { check: "false", want: true, fix: async ({ exec }) => { await exec("") } })`,
      expected:
        "a\n  ! Bad exec\n      failed to run the fix for step 'Bad exec' -> failed to validate the command given to 'exec' -> must be non-empty\n\na   failed",
    },
  ])("should fail $description", async (testCase) => {
    const { command, body, expected } = testCase
    const { dir, run } = await createProject()
    await writeLocalHost(path.join(dir, "hosts"), "a", body)

    const { stdout, exitCode } = await run`tsinfra ${command}`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe(expected)
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

  it("should exit 0 from plan when the only change is a run", async () => {
    const { dir, run } = await createProject()
    await writeLocalHost(path.join(dir, "hosts"), "a", `await h.run("Prune", "true", { after: "always" })`)

    expect((await run`tsinfra plan`.nothrow()).exitCode).toBe(0)
  })

  it("should exit 1 from plan when a host fails, even with drift on another", async () => {
    const { dir, run } = await createProject()
    const hostsDir = path.join(dir, "hosts")
    await writeLocalHost(hostsDir, "a", `await h.ensure("Pending", { check: "false", want: true, fix: "true" })`)
    await writeLocalHost(hostsDir, "b", `await h.read("exit 1")`)

    expect((await run`tsinfra plan`.nothrow()).exitCode).toBe(1)
  })

  it("should show reads and steps that were already right with --verbose", async () => {
    const { dir, run } = await createProject()
    const steps = [`await h.read("true")`, `await h.ensure("Install git", { check: "true", want: true, fix: "true" })`]
    await writeLocalHost(path.join(dir, "hosts"), "a", steps.join("\n"))

    const { stdout, exitCode } = await run`tsinfra plan --verbose`.nothrow()

    expect(exitCode).toBe(0)
    expect(stdout).toBe("a\n  · true\n  = Install git\n\na   unchanged")
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
