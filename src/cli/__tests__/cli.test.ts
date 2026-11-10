import { describe, expect, it, setDefaultTimeout } from "bun:test"
import path from "node:path"

import bun from "bun"

import { createProject } from "#cli/__tests__/utils.ts"

setDefaultTimeout(30_000)

const PLAN_REMINDER = "Steps after a change were checked without that change, so apply may differ."

describe("tsinfra", () => {
  it("should show what would change on stdout and exit 2 from plan, without running the fix", async () => {
    const { dir, run } = await createProject()
    const marker = path.join(dir, "marker")

    const { stdout, stderr, exitCode } = await run`tsinfra plan`.env({ MARKER: marker }).nothrow()

    expect(exitCode).toBe(2)
    expect(stdout).toBe(
      [
        "sonarr",
        "  ~ change:    (ensure) Make marker",
        "  > triggered: (run)    Restart",
        "",
        PLAN_REMINDER,
        "",
        "caddy    unchanged",
        "sonarr   2 changes",
      ].join("\n"),
    )
    expect(stderr).toBe("")
    expect(await bun.file(marker).exists()).toBe(false)
  })

  it("should run the fix and exit 0 from apply", async () => {
    const { dir, run } = await createProject()
    const marker = path.join(dir, "marker")

    const { exitCode } = await run`tsinfra apply`.env({ MARKER: marker }).nothrow()

    expect(exitCode).toBe(0)
    expect(await bun.file(marker).exists()).toBe(true)
  })

  it("should run only the named host from the hosts dir it's given, with every step in verbose", async () => {
    const { run } = await createProject()

    const { stdout, exitCode } = await run`tsinfra plan --hosts-dir hosts-select --verbose a`.nothrow()

    expect(exitCode).toBe(0)
    expect(stdout).toBe("a\n  · observed:  (read)   true\n  = unchanged: (ensure) Install git\n\na   unchanged")
  })

  it("should print a failed host's error on stdout and exit 1, even with drift on another host", async () => {
    const { run } = await createProject()

    const { stdout, stderr, exitCode } = await run`tsinfra plan --hosts-dir hosts-failing`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe(
      [
        "a",
        "  ~ change: (ensure) Pending",
        "",
        "b",
        "  ! failed: (host fn) @local",
        "      boom",
        "        thrown in the host function, outside any step",
        "",
        PLAN_REMINDER,
        "",
        "a   1 change",
        "b   failed",
      ].join("\n"),
    )
    expect(stderr).toBe("")
  })

  it("should print the error to stderr and exit 1 when the hosts can't be discovered", async () => {
    const { run } = await createProject()

    const { stdout, stderr, exitCode } = await run`tsinfra plan --hosts-dir nowhere`.nothrow()

    expect(exitCode).toBe(1)
    expect(stdout).toBe("")
    expect(stderr).toStartWith("Error: failed to discover hosts -> failed to read hosts directory 'nowhere' -> ENOENT")
  })
})
