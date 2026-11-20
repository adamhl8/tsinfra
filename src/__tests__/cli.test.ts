import { describe, expect, it, setDefaultTimeout } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"

import { makeTempDir, minimalEnv } from "@adamhl8/configs/test"
import bun from "bun"
import pc from "picocolors"

import { createProject, getInstalledBin, replaceInstalledFile } from "#__tests__/cli-project.ts"
import { answerPrompts } from "#__tests__/terminal.ts"
import packageJson from "#package.json" with { type: "json" }

setDefaultTimeout(30_000)

// Build the colors the subprocess prints with `FORCE_COLOR`, because the test preload turns them off in this process.
const COLORS = pc.createColors(true)
const PLAN_REMINDER = "Steps after a change were checked without that change, so apply may differ."
// Match what `readline.clearLine` and `readline.cursorTo` write: erase the line, then go to its first column.
const CLEAR_PROGRESS = "\u001B[2K\u001B[1G"
// Stand in for the project's CLI with one that shows the arguments it got and sets its own exit code.
const ARGUMENTS_CLI = "console.log(JSON.stringify(process.argv.slice(2)))\nprocess.exitCode = 3\n"
const NOT_INSTALLED_ERROR =
  'Error: tsinfra isn\'t installed in this project\nAdd it with `bun add --dev tsinfra`, because host scripts import "tsinfra".'

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

/** Starts a stand-in npm registry that answers every request with a 404 and counts them. */
const startRegistry = () => {
  let requestCount = 0
  const server = bun.serve({
    port: 0,
    fetch: () => {
      requestCount += 1
      return new Response("not found", { status: 404 })
    },
  })

  return { url: server.url.href, getRequestCount: () => requestCount, stop: async () => server.stop() }
}

describe("the global copy", () => {
  it("should hand off to the project's copy with the same arguments and keep its exit code", async () => {
    const { dir } = await createProject()
    const { dir: globalDir, run } = await createProject()
    await replaceInstalledFile(dir, "dist/cli.js", ARGUMENTS_CLI)

    const { stdout, exitCode } = await run`${getInstalledBin(globalDir)} plan --verbose sonarr`.cwd(dir).nothrow()

    expect(stdout).toBe('["plan","--verbose","sonarr"]')
    expect(exitCode).toBe(3)
  })

  it("should print the same output as the project's own copy", async () => {
    const { dir, run } = await createProject()
    const { dir: globalDir } = await createProject()
    const env = { MARKER: path.join(dir, "marker") }

    const projectOutput = await run`tsinfra plan`.env(env).nothrow()
    const globalOutput = await run`${getInstalledBin(globalDir)} plan`.env(env).nothrow()

    expect(globalOutput.stdout).toBe(projectOutput.stdout)
    expect(globalOutput.stderr).toBe(projectOutput.stderr)
    expect(globalOutput.exitCode).toBe(projectOutput.exitCode)
  })

  it("should hand off from a folder inside the project", async () => {
    const { dir } = await createProject()
    const { dir: globalDir, run } = await createProject()
    await replaceInstalledFile(dir, "dist/cli.js", ARGUMENTS_CLI)

    const { stdout } = await run`${getInstalledBin(globalDir)} plan`.cwd(path.join(dir, "hosts")).nothrow()

    expect(stdout).toBe('["plan"]')
  })

  it("should say to update both copies when the project's copy has no 'tsinfra/cli' export", async () => {
    const { dir } = await createProject()
    const { dir: globalDir, run } = await createProject()
    // Match the exports of a copy from before the hand-off.
    const oldPackageJson = { name: "tsinfra", type: "module", exports: { ".": "./dist/index.js" } }
    await replaceInstalledFile(dir, "package.json", JSON.stringify(oldPackageJson))

    const { stderr, exitCode } = await run`${getInstalledBin(globalDir)} plan`.cwd(dir).nothrow()

    expect(exitCode).toBe(1)
    expect(stderr).toBe(
      "Error: the project's copy of tsinfra has no 'tsinfra/cli' export\nUpdate both your global and local copies of tsinfra.",
    )
  })

  it("should let a crash in the project's copy through as Bun prints it", async () => {
    const { dir } = await createProject()
    const { dir: globalDir, run } = await createProject()
    await replaceInstalledFile(dir, "dist/cli.js", 'throw new Error("broken project copy")\n')

    const { stderr, exitCode } = await run`${getInstalledBin(globalDir)} plan`.cwd(dir).nothrow()

    expect(exitCode).toBe(1)
    expect(stderr).toContain("error: broken project copy")
    expect(stderr).not.toContain("Update both")
  })

  it("should fail without asking the registry when no node_modules is up the tree", async () => {
    const { dir: globalDir, run } = await createProject()
    const emptyDir = await makeTempDir()
    const registry = startRegistry()

    const { stderr, exitCode } = await run`${getInstalledBin(globalDir)} plan`
      .cwd(emptyDir)
      .env({ BUN_CONFIG_REGISTRY: registry.url })
      .nothrow()
    await registry.stop()

    expect(exitCode).toBe(1)
    expect(stderr).toBe(NOT_INSTALLED_ERROR)
    expect(registry.getRequestCount()).toBe(0)
  })

  it("should fail when the project's node_modules has no tsinfra", async () => {
    const { dir: globalDir, run } = await createProject()
    const emptyDir = await makeTempDir()
    await fs.mkdir(path.join(emptyDir, "node_modules"))

    const { stderr, exitCode } = await run`${getInstalledBin(globalDir)} plan`.cwd(emptyDir).nothrow()

    expect(exitCode).toBe(1)
    expect(stderr).toBe(NOT_INSTALLED_ERROR)
  })

  it("should answer --help and a command's --help itself outside a project", async () => {
    const { dir: globalDir, run } = await createProject()
    const emptyDir = await makeTempDir()

    const help = await run`${getInstalledBin(globalDir)} --help`.cwd(emptyDir).nothrow()
    const planHelp = await run`${getInstalledBin(globalDir)} plan --help`.cwd(emptyDir).nothrow()

    expect(help.exitCode).toBe(0)
    expect(help.stdout).toContain("Usage: tsinfra plan")
    expect(help.stdout).toContain("tsinfra apply")
    expect(planHelp.exitCode).toBe(0)
    expect(planHelp.stdout).toStartWith("Show what would change on each host\nUsage: tsinfra plan")
  })

  it("should show its own version, labeled global, outside a project", async () => {
    const { dir: globalDir, run } = await createProject()
    const emptyDir = await makeTempDir()

    const { stdout, exitCode } = await run`${getInstalledBin(globalDir)} --version`.cwd(emptyDir).nothrow()

    expect(exitCode).toBe(0)
    expect(stdout).toBe(`${packageJson.version} (global)`)
  })

  it.each([["--version"], ["plan", "--verbose", "--version"]])(
    "should show the project's version and its own for %p",
    async (...args) => {
      const { dir } = await createProject()
      const { dir: globalDir, run } = await createProject()
      // Give the project's copy its own version, because both installs come from one pack.
      await replaceInstalledFile(dir, "package.json", JSON.stringify({ ...packageJson, version: "0.0.0-project" }))

      const { stdout, exitCode } = await run`${getInstalledBin(globalDir)} ${args}`.cwd(dir).nothrow()

      expect(exitCode).toBe(0)
      expect(stdout).toBe(`0.0.0-project (project)\n${packageJson.version} (global)`)
    },
  )

  it("should show only its own version, labeled project, when the project's copy is started directly", async () => {
    const { run } = await createProject()

    const { stdout, exitCode } = await run`tsinfra --version`.nothrow()

    expect(exitCode).toBe(0)
    expect(stdout).toBe(`${packageJson.version} (project)`)
  })
})
