import { describe, expect, it, setDefaultTimeout } from "bun:test"
import path from "node:path"
import process from "node:process"

import { minimalEnv } from "@adamhl8/configs/test"
import bun from "bun"
import pc from "picocolors"

import { createProject } from "#__tests__/cli-project.ts"
import { answerPrompts } from "#__tests__/terminal.ts"

setDefaultTimeout(30_000)

// Build the colors the subprocess prints with `FORCE_COLOR`, because the test preload turns them off in this process.
const COLORS = pc.createColors(true)
const PLAN_REMINDER = "Steps after a change were checked without that change, so apply may differ."
// Match what `readline.clearLine` and `readline.cursorTo` write: erase the line, then go to its first column.
const CLEAR_PROGRESS = "\u001B[2K\u001B[1G"

/** Returns the command that runs the installed `tsinfra plan` on the project's `hostsDir`. */
const buildPlanCommand = (dir: string, hostsDir: string) => [
  process.execPath,
  path.join(dir, "node_modules/.bin/tsinfra"),
  "plan",
  "--hosts-dir",
  path.join(dir, hostsDir),
]

/** Returns what the terminal showed after the last progress line was cleared, which is the report. */
const getScreenAfterProgress = (screen: string) =>
  screen.slice(screen.lastIndexOf(CLEAR_PROGRESS) + CLEAR_PROGRESS.length)

describe("tsinfra", () => {
  it("should show what would change on stdout and exit 2 from plan, without running the fix", async () => {
    const { dir, run } = await createProject()
    const marker = path.join(dir, "marker")

    const { stdout, stderr, exitCode } = await run`tsinfra plan`.env({ MARKER: marker }).nothrow()

    expect(exitCode).toBe(2)
    expect(stdout).toBe(
      [
        "sonarr",
        "  ~ change: (ensure) Make marker",
        "  > triggered: (run) Restart",
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
    expect(stdout).toBe("a\n  · observed: (read) true\n  = unchanged: (ensure) Install git\n\na   unchanged")
  })

  it("should show only the summary and exit 0 from plan when the only change is an always run", async () => {
    const { run } = await createProject()

    const { stdout, exitCode } = await run`tsinfra plan --hosts-dir hosts-always`.nothrow()

    expect(exitCode).toBe(0)
    expect(stdout).toBe("prune   unchanged")
  })

  it.each([["-vv"], ["-v", "-v"]])("should count %s as level 2, and list commands", async (...flags) => {
    const { run } = await createProject()

    const { stdout, exitCode } = await run`tsinfra plan --hosts-dir hosts-select ${flags} a`.nothrow()

    expect(exitCode).toBe(0)
    expect(stdout).toBe(
      "a\n  · observed: (read) true\n  = unchanged: (ensure) Install git\n      commands:\n        $ true\n\na   unchanged",
    )
  })

  it("should count more than three -v flags as level 3, and show what each command printed", async () => {
    const { run } = await createProject()

    const { stdout, exitCode } = await run`tsinfra plan --hosts-dir hosts-select -vvvv a`.nothrow()

    expect(exitCode).toBe(0)
    expect(stdout).toBe(
      "a\n  · observed: (read) true\n      output:\n        exit: 0\n  = unchanged: (ensure) Install git\n      commands:\n        before:\n          $ true\n              output:\n                exit: 0\n\na   unchanged",
    )
  })

  it("should dim every [MASKED], with the text around it in its own color", async () => {
    const { run } = await createProject()

    const { stdout } = await run`tsinfra apply --hosts-dir hosts-masked -vvv`.env({ FORCE_COLOR: "1" }).nothrow()

    const masked = COLORS.dim("[MASKED]")
    expect(stdout.split(masked).length).toBe(stdout.split("[MASKED]").length)
    expect(stdout).toContain(`${COLORS.cyan("token=")}${masked}`)
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
        "  ! failed: (host fn)",
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

  it("should show a progress line in a terminal while it prepares and runs each host, and clear it before the report", async () => {
    const { dir } = await createProject()
    const env = { ...minimalEnv(), MARKER: path.join(dir, "marker"), NO_COLOR: "1" }

    const { screen } = await answerPrompts(buildPlanCommand(dir, "hosts"), "", [], env)

    expect(screen).toStartWith(`Preparing 2 hosts...${CLEAR_PROGRESS}Planning host 'caddy'...${CLEAR_PROGRESS}`)
    expect(screen).toContain(`Planning host 'sonarr'...${CLEAR_PROGRESS}`)
    // Expect `\r\n` for every newline in the report, because the terminal turns each `\n` into `\r\n`.
    expect(getScreenAfterProgress(screen)).toBe(
      [
        "sonarr",
        "  ~ change: (ensure) Make marker",
        "  > triggered: (run) Restart",
        "",
        PLAN_REMINDER,
        "",
        "caddy    unchanged",
        "sonarr   2 changes",
        "",
      ].join("\r\n"),
    )
  })

  it("should show the running step on the progress line, cut to one line that fits the terminal", async () => {
    const { dir } = await createProject()

    const { screen } = await answerPrompts(buildPlanCommand(dir, "hosts-progress"), "", [], {
      ...minimalEnv(),
      NO_COLOR: "1",
    })

    // Expect 79 columns, one short of the terminal's 80.
    expect(screen).toContain(
      `${CLEAR_PROGRESS}Planning host 'slow' · (read) sleep 0.5 # ${"x".repeat(36)}…${CLEAR_PROGRESS}`,
    )
    expect(getScreenAfterProgress(screen)).toBe("slow   unchanged\r\n")
  })
})
