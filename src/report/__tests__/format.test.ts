import { describe, expect, it } from "bun:test"
import { chmod, lstat, mkdir, stat, symlink } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"
import { attempt, isErr } from "ts-explicit-errors"

import {
  UNREACHABLE_TARGET,
  createFakeSudoSession,
  prepareAndRunHost,
  prepareHostContext,
  toLoadedHost,
} from "#__tests__/session.ts"
import type { HostFunction } from "#hosts/host.ts"
import { host } from "#hosts/host.ts"
import type { Mode } from "#mode.ts"
import { formatHostBlock } from "#report/format/format.ts"
import { formatSummary } from "#report/summary.ts"
import type { Want } from "#session/handlers/ensure/check.ts"
import type { EnsureOptions } from "#session/handlers/ensure/ensure.ts"
import type { Host } from "#session/session.ts"
import { createHostSession } from "#session/session.ts"
import type { Transport } from "#transport/transport.ts"

const runNamedHost = async (name: string, fn: HostFunction, mode: Mode) =>
  prepareAndRunHost(toLoadedHost(name, host("@local", fn)), mode)

const isRoot = process.getuid?.() === 0

const formatBlock = async (fn: HostFunction, mode: Mode) => formatHostBlock(await runNamedHost("a", fn, mode))

const formatVerboseBlock = async (fn: HostFunction) =>
  formatHostBlock(await runNamedHost("a", fn, "plan"), { verbose: true })

const changeAndRun = async (h: Host) => {
  await h.ensure("Write the unit", { check: "false", want: true, fix: "true" })
  await h.run("Reload systemd", "true", { after: "always" })
  await h.run("Prune", "true", { after: "always" })
}

const runOnce = async (h: Host) => {
  await h.run("Reload systemd", "true", { after: "always" })
}

const stayRight = async (h: Host) => {
  const caddy = await h.ensure("Install Caddy", { check: "true", want: true, fix: "true" })
  await h.read("true")
  await h.run("Reload systemd", "true", { after: [caddy] })
}

const failVerify = async (h: Host) => {
  await h.ensure("Make it", { check: "echo missing >&2; false", want: true, fix: "true" })
}

const waitOnBrew = async (h: Host) => {
  const brew = await h.ensure("Install brew packages", { check: "false", want: true, fix: "true" })
  await h.ensure("Install fish plugins", { needs: [brew], check: "true", want: true, fix: "true" })
}

const waitTwiceOnBrew = async (h: Host) => {
  const brew = await h.ensure("Install brew packages", { check: "false", want: true, fix: "true" })
  await h.ensure("Install fish", { needs: [brew], check: "true", want: true, fix: "true" })
  await h.ensure("Install fish plugins", { needs: [brew], check: "true", want: true, fix: "true" })
}

const failRead = async (h: Host) => {
  await h.read("exit 1")
}

const changeThenThrow = async (h: Host) => {
  await h.ensure("Pending", { check: "false", want: true, fix: "true" })
  throw new Error("boom")
}

const runStepsAtOnce = async (h: Host) => {
  await Promise.allSettled([
    h.ensure("First", { check: "sleep 0.1", want: true, fix: "true" }),
    h.ensure("Second", { check: "true", want: true, fix: "true" }),
  ])
}

const nestStep = async (h: Host) => {
  await h.ensure("Outer", {
    check: "false",
    want: true,
    fix: async () => {
      await h.ensure("Inner", { check: "true", want: true, fix: "true" })
    },
  })
}

const catchFailedExec = async (h: Host) => {
  await h.ensure("Make marker", {
    check: "false",
    want: true,
    fix: async ({ exec }) => {
      await attempt(async () => exec("exit 1"))
    },
  })
}

const changeOnce = async (h: Host) => {
  await h.ensure("Pending", { check: "false", want: true, fix: "true" })
}

const failFix = async (h: Host) => {
  await h.ensure("Make it", { check: "echo early >&2; echo old", want: "new", fix: "exit 1" })
}

const failSecondCompare = async (h: Host) => {
  const marker = path.join(await makeTempDir(), "marker")
  await h.ensure("Make it", {
    check: async ({ read }) => read(`test ! -f '${marker}' && echo old`),
    want: "new",
    fix: `touch '${marker}'`,
  })
}

describe("formatHostBlock", () => {
  it("should mark a changed step with '~' and a ran step with '>' in plan", async () => {
    expect(await formatBlock(changeAndRun, "plan")).toBe(
      "a\n  ~ change:    (ensure) Write the unit\n  > triggered: (run)    Reload systemd\n  > triggered: (run)    Prune",
    )
  })

  it("should mark a ran step with '>' in apply", async () => {
    expect(await formatBlock(runOnce, "apply")).toBe("a\n  > triggered: (run) Reload systemd")
  })

  it("should return nothing when every step was already right", async () => {
    expect(await formatBlock(stayRight, "plan")).toBeUndefined()
  })

  it("should show every step with --verbose, a read by its command", async () => {
    expect(await formatVerboseBlock(stayRight)).toBe(
      [
        "a",
        "  = unchanged: (ensure) Install Caddy",
        "  · observed:  (read)   true",
        "  = unchanged: (run)    Reload systemd",
      ].join("\n"),
    )
  })

  it("should give a host with no steps a block with --verbose", async () => {
    expect(
      await formatVerboseBlock(async () => {
        /* empty */
      }),
    ).toBe(["a", "  no steps"].join("\n"))
  })

  it("should line up the notes of a block's waiting steps in one column", async () => {
    expect(await formatBlock(waitTwiceOnBrew, "plan")).toBe(
      [
        "a",
        "  ~ change:  (ensure) Install brew packages",
        "  ? waiting: (ensure) Install fish           needs 'Install brew packages'",
        "  ? waiting: (ensure) Install fish plugins   needs 'Install brew packages'",
      ].join("\n"),
    )
  })

  it("should mark a waiting step with '?' and the steps it needs", async () => {
    expect(await formatBlock(waitOnBrew, "plan")).toBe(
      [
        "a",
        "  ~ change:  (ensure) Install brew packages",
        "  ? waiting: (ensure) Install fish plugins   needs 'Install brew packages'",
      ].join("\n"),
    )
  })

  it("should show a failed step's error on indented lines under it", async () => {
    expect(await formatBlock(failVerify, "apply")).toBe(
      [
        "a",
        "  ! failed: (ensure) Make it",
        "      the host's state still differs after the fix",
        "        got:    exit code 1",
        "        want:   exit code 0",
        "        stderr: echo missing >&2; false -> missing",
      ].join("\n"),
    )
  })

  it("should name a failed read by its command", async () => {
    expect(await formatBlock(failRead, "plan")).toBe(
      "a\n  ! failed: (read) exit 1\n      failed to read 'exit 1' -> exited with code 1",
    )
  })

  it("should show a failure that isn't any step's after the steps", async () => {
    expect(await formatBlock(changeThenThrow, "plan")).toBe(
      "a\n  ~ change: (ensure)  Pending\n  ! failed: (host fn) @local\n      boom\n        thrown in the host function, outside any step",
    )
  })

  it("should name a host that couldn't be prepared after its target, and count it as failed", async () => {
    const hostRecord = await prepareAndRunHost(toLoadedHost("a", host(UNREACHABLE_TARGET, changeThenThrow)), "plan")
    const startError =
      "failed to read the ssh config for 'unreachable host' -> exited with code 255: hostname contains invalid characters"

    expect([formatHostBlock(hostRecord), formatSummary([hostRecord], "plan")]).toStrictEqual([
      `a\n  ! failed: (host) ${UNREACHABLE_TARGET}\n      ${startError}`,
      "a   failed",
    ])
  })

  it("should show a hint under a host that couldn't be prepared", () => {
    const hostBlock = formatHostBlock({
      name: "a",
      target: "a.lan",
      preparation: {
        commands: [],
        status: new Error("Host key verification failed."),
        failureHints: ["run 'ssh a.lan' once to check the host's key and save it"],
      },
      stepRecords: [],
      failure: undefined,
    })

    expect(hostBlock).toBe(
      [
        "a",
        "  ! failed: (host) a.lan",
        "      Host key verification failed.",
        "        run 'ssh a.lan' once to check the host's key and save it",
      ].join("\n"),
    )
  })

  it("should show the error from steps run at once under the step that was running", async () => {
    expect(await formatBlock(runStepsAtOnce, "plan")).toBe(
      "a\n  ! failed: (ensure) First\n      'ensure' can't run while ensure step 'First' is running",
    )
  })

  it("should show a failure the script caught under the step it happened in", async () => {
    expect(await formatBlock(catchFailedExec, "apply")).toBe(
      [
        "a",
        "  ! failed: (ensure) Make marker",
        "      failed to run 'exit 1' -> exited with code 1",
        "        got:  exit code 1",
        "        want: exit code 0",
      ].join("\n"),
    )
  })

  it("should show a nested step's failure once, under the outer step", async () => {
    expect(await formatBlock(nestStep, "apply")).toBe(
      "a\n  ! failed: (ensure) Outer\n      failed to run the fix -> 'ensure' can't run while ensure step 'Outer' is running",
    )
  })
})

/** Formats the block of an apply whose step still differs after its fix, as the lines under the error. */
const formatFailedCheck = async <T extends Want>(options: EnsureOptions<T>) => {
  const hostBlock = await formatBlock(async (h) => {
    await h.ensure("Make it", options)
  }, "apply")
  return hostBlock?.split("\n").slice(3)
}

describe("formatHostBlock for a step that would change a string", () => {
  it("should show got and want under the step for a single-line value", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Start Sonarr", { check: "echo inactive", want: "active", fix: "true" })
    }, "plan")

    expect(hostBlock).toBe(
      ["a", "  ~ change: (ensure) Start Sonarr", "      got:  'inactive'", "      want: 'active'"].join("\n"),
    )
  })

  it("should show a diff under the step for a multi-line value", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Write the config", { check: String.raw`printf 'a\nb\nc\n'`, want: "a\nB\nc", fix: "true" })
    }, "plan")

    expect(hostBlock).toBe(
      [
        "a",
        "  ~ change: (ensure) Write the config",
        `      ${"─".repeat(4)}`,
        "      1  a",
        "        -b",
        "      2 +B",
        "      3  c",
        `      ${"─".repeat(4)}`,
      ].join("\n"),
    )
  })

  it("should number lines by want, leave removed lines unnumbered, and rule off each hunk", async () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)
    const wanted = [...lines.slice(0, -1), "line twenty"]
    wanted[0] = "line one"
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Write the config", {
        check: `printf '%s\\n' ${lines.map((line) => `'${line}'`).join(" ")}`,
        want: wanted.join("\n"),
        fix: "true",
      })
    }, "plan")

    expect(hostBlock).toBe(
      [
        "a",
        "  ~ change: (ensure) Write the config",
        `      ${"─".repeat(15)}`,
        "         -line 1",
        "       1 +line one",
        "       2  line 2",
        `      ${"─".repeat(15)}`,
        "      19  line 19",
        "         -line 20",
        "      20 +line twenty",
        `      ${"─".repeat(15)}`,
      ].join("\n"),
    )
  })
})

describe("formatHostBlock for a file step", () => {
  it("should show a file's diff and each attribute that changes, old value to new", async () => {
    const filePath = path.join(await makeTempDir(), "app.conf")
    await bun.write(filePath, "port = 8080\nworkers = 4\n")
    await chmod(filePath, 0o600)
    const hostBlock = await formatBlock(async (h) => {
      await h.file(filePath, "port = 8080\nworkers = 8\n", { mode: "644" })
    }, "plan")

    expect(hostBlock).toBe(
      [
        "a",
        `  ~ change: (file) ${filePath}`,
        `      ${"─".repeat(14)}`,
        "      1  port = 8080",
        "        -workers = 4",
        "      2 +workers = 8",
        `      ${"─".repeat(14)}`,
        "      mode: rw------- (600) -> rw-r--r-- (644)",
      ].join("\n"),
    )
  })

  it.each([
    ["padded to three digits", "044", "---r--r-- (044)"],
    ["with the special bits and execute", "7755", "rwsr-sr-t (7755)"],
    ["with the special bits and no execute", "5644", "rwSr--r-T (5644)"],
  ] as const)("should show a mode in both notations: %s", async (_, mode, expected) => {
    const filePath = path.join(await makeTempDir(), "app.conf")
    await bun.write(filePath, "a\n")
    await chmod(filePath, 0o644)
    const hostBlock = await formatBlock(async (h) => {
      await h.file(filePath, "a\n", { mode })
    }, "plan")

    expect(hostBlock).toContain(`mode: rw-r--r-- (644) -> ${expected}`)
  })

  it("should show a user and a group given as ids", async () => {
    const filePath = path.join(await makeTempDir(), "app.conf")
    await bun.write(filePath, "a\n")
    const { uid, gid } = await stat(filePath)
    const { hostSession } = await createFakeSudoSession("plan")
    await hostSession.host.file(filePath, "a\n", { user: uid + 1, group: gid + 1, sudo: true })
    const hostBlock = formatHostBlock(hostSession.hostRecord)

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([
      `      user:  ${uid} -> ${uid + 1}`,
      `      group: ${gid} -> ${gid + 1}`,
    ])
  })

  it("should show a new link and a warning for a missing target", async () => {
    const directory = await makeTempDir()
    const linkPath = path.join(directory, "link")
    const target = path.join(directory, "target")
    const hostBlock = await formatBlock(async (h) => {
      await h.link(linkPath, target)
    }, "plan")

    expect(hostBlock).toBe(
      [
        "a",
        `  ~ change: (link) ${linkPath}`,
        `      target: new link to ${target}`,
        `      warning: nothing exists at target -> ${target}`,
      ].join("\n"),
    )
  })

  it("should show a link's new target, with no note when the target exists", async () => {
    const directory = await makeTempDir()
    const linkPath = path.join(directory, "link")
    await symlink("/old", linkPath)
    const hostBlock = await formatBlock(async (h) => {
      await h.link(linkPath, directory)
    }, "plan")

    expect(hostBlock).toBe(["a", `  ~ change: (link) ${linkPath}`, `      target: /old -> ${directory}`].join("\n"))
  })

  it.each([
    ["a file", "replaces a file, with a link to", async (filePath: string) => bun.write(filePath, "a\n")],
    ["an empty directory", "replaces an empty directory, with a link to", async (filePath: string) => mkdir(filePath)],
  ])("should show that a forced link replaces %s", async (_, words, createExisting) => {
    const directory = await makeTempDir()
    const linkPath = path.join(directory, "link")
    await createExisting(linkPath)
    const hostBlock = await formatBlock(async (h) => {
      await h.link(linkPath, directory, { force: true })
    }, "plan")

    expect(hostBlock).toBe(["a", `  ~ change: (link) ${linkPath}`, `      target: ${words} ${directory}`].join("\n"))
  })

  it("should line up a link's target with its owner rows", async () => {
    const directory = await makeTempDir()
    const linkPath = path.join(directory, "link")
    await symlink("/old", linkPath)
    const { uid } = await lstat(linkPath)
    const { hostSession } = await createFakeSudoSession("plan")
    await hostSession.host.link(linkPath, directory, { user: uid + 1, sudo: true })
    const hostBlock = formatHostBlock(hostSession.hostRecord)

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([
      `      target: /old -> ${directory}`,
      `      user:   ${uid} -> ${uid + 1}`,
    ])
  })

  it("should show a note for a new file", async () => {
    const filePath = path.join(await makeTempDir(), "app.conf")
    const hostBlock = await formatBlock(async (h) => {
      await h.file(filePath, "a".repeat(2048))
    }, "plan")

    expect(hostBlock).toBe(["a", `  ~ change: (file) ${filePath}`, "      content: new file, 2.05 kB"].join("\n"))
  })

  it("should spell out a size under 1 kB in bytes", async () => {
    const filePath = path.join(await makeTempDir(), "app.conf")
    const hostBlock = await formatBlock(async (h) => {
      await h.file(filePath, "a")
      await h.file(`${filePath}.new`, "abc")
    }, "plan")

    expect(hostBlock).toBe(
      [
        "a",
        `  ~ change: (file) ${filePath}`,
        "      content: new file, 1 byte",
        `  ~ change: (file) ${filePath}.new`,
        "      content: new file, 3 bytes",
      ].join("\n"),
    )
  })
})

describe("formatHostBlock for a host state that still differs after the fix", () => {
  it("should show the exit codes when a want: false check still exits 0", async () => {
    expect(await formatFailedCheck({ check: "true", want: false, fix: "true" })).toStrictEqual([
      "        got:  exit code 0",
      "        want: a non-zero exit code",
    ])
  })

  it("should show the booleans a function check compared", async () => {
    const lines = await formatFailedCheck({
      check: async ({ read }) => (await read("echo no")) === "yes",
      want: true,
      fix: "true",
    })

    expect(lines).toStrictEqual(["        got:  false", "        want: true"])
  })

  it("should quote both values of a string check", async () => {
    expect(await formatFailedCheck({ check: "echo v1", want: "v2", fix: "true" })).toStrictEqual([
      "        got:  'v1'",
      "        want: 'v2'",
    ])
  })

  it("should quote an empty value so it shows", async () => {
    expect(await formatFailedCheck({ check: "true", want: "v2", fix: "true" })).toStrictEqual([
      "        got:  ''",
      "        want: 'v2'",
    ])
  })

  it("should show stderr when a string check exits non-zero", async () => {
    const lines = await formatFailedCheck({ check: "echo v1; echo oops >&2; exit 3", want: "v2", fix: "true" })

    expect(lines).toStrictEqual([
      "        got:    'v1'",
      "        want:   'v2'",
      "        stderr: echo v1; echo oops >&2; exit 3 -> oops",
    ])
  })

  it("should line up a multi-line stderr under its first line", async () => {
    const lines = await formatFailedCheck({ check: "echo one >&2; echo two >&2; false", want: true, fix: "true" })

    expect(lines).toStrictEqual([
      "        got:    exit code 1",
      "        want:   exit code 0",
      "        stderr: echo one >&2; echo two >&2; false -> one",
      "                two",
    ])
  })

  it("should leave the empty lines out of a multi-line stderr", async () => {
    const lines = await formatFailedCheck({
      check: "echo one >&2; echo >&2; echo two >&2; false",
      want: true,
      fix: "true",
    })

    expect(lines).toStrictEqual([
      "        got:    exit code 1",
      "        want:   exit code 0",
      "        stderr: echo one >&2; echo >&2; echo two >&2; false -> one",
      "                two",
    ])
  })

  it("should show a multi-line value as a diff, with stderr after it", async () => {
    const check = String.raw`printf 'a\nb\n'; echo warn >&2`
    const lines = await formatFailedCheck({ check, want: "a\nc", fix: "true" })

    expect(lines).toStrictEqual([
      `        ${"─".repeat(4)}`,
      "        1  a",
      "          -b",
      "        2 +c",
      `        ${"─".repeat(4)}`,
      `        stderr: ${check} -> warn`,
    ])
  })
})

/**
 * Creates a session where every command writes to stderr, and `filePath` changes right after a write, so it still
 * differs.
 */
const createNoisySession = async (filePath: string) => {
  const hostContext = await prepareHostContext(toLoadedHost("a", host("@local", changeOnce)))
  if (isErr(hostContext)) throw hostContext

  const transport: Transport = async (cmd) => {
    const output = await hostContext.transport(`echo noise >&2\n${cmd}`)
    if (cmd.includes("mv -f")) await bun.write(filePath, "changed\n")
    return output
  }
  return createHostSession({ ...hostContext, transport }, "apply")
}

describe("formatHostBlock for the stderr of a step that still differs", () => {
  const AFTER_FIX_NOTE = "        some commands after the fix wrote to stderr, run with -vvv to see them"
  const DURING_FIX_NOTE = "        some commands during the fix wrote to stderr, run with -vvv to see them"

  it("should show nothing extra when no command wrote to stderr", async () => {
    const lines = await formatFailedCheck({ check: "false", want: true, fix: "true" })

    expect(lines).toStrictEqual(["        got:  exit code 1", "        want: exit code 0"])
  })

  it("should show the stderr of a check that exits 0", async () => {
    const check = "echo warn >&2"
    const lines = await formatFailedCheck({ check, want: "x", fix: "true" })

    expect(lines).toContain(`        stderr: ${check} -> warn`)
  })

  it("should show a fix's stderr, then the check's, each with its command", async () => {
    const fix = "echo ignored >&2"
    const check = "echo warn >&2; false"
    const lines = await formatFailedCheck({ check, want: true, fix })

    expect(lines?.slice(2)).toStrictEqual([`        stderr: ${fix} -> ignored`, `        stderr: ${check} -> warn`])
  })

  it("should show the stderr of a check function that runs one command", async () => {
    const cmd = "echo refused >&2; exit 7"
    const lines = await formatFailedCheck({
      check: async ({ inspect }) => (await inspect(cmd)).exitCode === 0,
      want: true,
      fix: "true",
    })

    expect(lines).toStrictEqual(["        got:    false", "        want:   true", `        stderr: ${cmd} -> refused`])
  })

  it("should show the note for a check function that runs several commands", async () => {
    const lines = await formatFailedCheck({
      check: async ({ inspect }) => {
        await inspect("echo warn >&2")
        await inspect("true")
        return false
      },
      want: true,
      fix: "true",
    })

    expect(lines).toStrictEqual(["        got:  false", "        want: true", AFTER_FIX_NOTE])
  })

  it("should show nothing extra when several commands wrote no stderr", async () => {
    const lines = await formatFailedCheck({
      check: async ({ inspect }) => {
        await inspect("true")
        await inspect("true")
        return false
      },
      want: true,
      fix: "true",
    })

    expect(lines).toStrictEqual(["        got:  false", "        want: true"])
  })

  it("should show a note for each phase that ran several commands", async () => {
    const lines = await formatFailedCheck({
      check: async ({ inspect }) => {
        await inspect("echo warn >&2")
        await inspect("true")
        return false
      },
      want: true,
      fix: async ({ exec }) => {
        await exec("echo warn >&2")
        await exec("true")
      },
    })

    expect(lines).toStrictEqual(["        got:  false", "        want: true", DURING_FIX_NOTE, AFTER_FIX_NOTE])
  })

  it("should show a phase's stderr next to a note for the phase it can't explain", async () => {
    const fix = "echo ignored >&2"
    const lines = await formatFailedCheck({
      check: async ({ inspect }) => {
        await inspect("echo warn >&2")
        await inspect("true")
        return false
      },
      want: true,
      fix,
    })

    expect(lines?.slice(2)).toStrictEqual([`        stderr: ${fix} -> ignored`, AFTER_FIX_NOTE])
  })

  it("should leave out the stderr from before the fix", async () => {
    const marker = path.join(await makeTempDir(), "marker")
    const lines = await formatFailedCheck({
      check: `test -f '${marker}' || echo early >&2; echo old`,
      want: "new",
      fix: `touch '${marker}'`,
    })

    expect(lines).toStrictEqual(["        got:  'old'", "        want: 'new'"])
  })

  it("should leave out the stderr of commands tsinfra wrote itself", async () => {
    const filePath = path.join(await makeTempDir(), "app.conf")
    const hostSession = await createNoisySession(filePath)
    await attempt(async () => hostSession.host.file(filePath, "a\n"))

    const hostBlock = formatHostBlock(hostSession.hostRecord)

    expect(hostBlock).toContain("the host's state still differs after the fix")
    expect(hostBlock).not.toContain("noise")
    expect(hostBlock).not.toContain("wrote to stderr")
  })
})

describe("formatHostBlock for a step that failed before it could compare again", () => {
  it.each([
    ["the fix failed", failFix],
    ["the compare after the fix failed", failSecondCompare],
  ])("should only show the error when %s", async (_, fn) => {
    const hostBlock = await formatBlock(fn, "apply")

    expect(hostBlock?.split("\n")).toHaveLength(3)
  })

  it.each([
    ["the fix failed", failFix],
    ["the compare after the fix failed", failSecondCompare],
  ])("should show the labelled values from before the fix with verbose when %s", async (_, fn) => {
    const hostRecord = await runNamedHost("a", fn, "apply")
    const lines = formatHostBlock(hostRecord, { verbose: true })?.split("\n").slice(3)

    expect(lines).toStrictEqual(["        values before the fix", "        got:  'old'", "        want: 'new'"])
  })

  it("should show no details when the last compare was in sync, because a caught failure failed the step", async () => {
    const marker = path.join(await makeTempDir(), "marker")
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Make it", {
        check: `test -f '${marker}'`,
        want: true,
        fix: async ({ exec }) => {
          await exec(`touch '${marker}'`)
          await attempt(async () => exec("exit 1"))
        },
      })
    }, "apply")

    expect(hostBlock).toBe(
      ["a", "  ! failed: (ensure) Make it", "      failed to run 'exit 1' -> exited with code 1"].join("\n"),
    )
  })

  it("should leave the empty lines out of a multi-line error", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Make it", { check: "false", want: true, fix: "echo one >&2; echo >&2; echo two >&2; exit 1" })
    }, "apply")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([
      "      failed to run the fix -> exited with code 1: one",
      "      two",
    ])
  })
})

/** Makes a link to a path that doesn't exist, in a new temp directory. */
const createBrokenLink = async () => {
  const directory = await makeTempDir()
  const linkPath = path.join(directory, "link")
  const target = path.join(directory, "missing")
  await symlink(target, linkPath)
  return { directory, linkPath, target }
}

// Print sudo's own line for a missing password, because the hint only reads the command's stderr.
const NEEDS_PASSWORD_CMD = "echo 'sudo: a password is required' >&2; exit 1"
const SUDO_OPTION_HINT = "        sudo needs a password on this host, so set the sudo option on host()"

describe("formatHostBlock for a sudo that needed a password", () => {
  it("should hint at the sudo option under the failed step, on a host that doesn't declare sudo", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.read(NEEDS_PASSWORD_CMD)
    }, "apply")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([
      `      failed to read '${NEEDS_PASSWORD_CMD}' -> exited with code 1: sudo: a password is required`,
      SUDO_OPTION_HINT,
    ])
  })

  it("should not hint at a failure the script throws, even after a sudo failed", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.inspect(NEEDS_PASSWORD_CMD)
      throw new Error("the service didn't start")
    }, "apply")

    expect(hostBlock?.split("\n").slice(1)).toStrictEqual([
      "  ! failed: (host fn) @local",
      "      the service didn't start",
      "        thrown in the host function, outside any step",
    ])
  })

  it("should not hint when sudo failed in an earlier step than the one that failed", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.inspect(NEEDS_PASSWORD_CMD)
      await h.read("echo 'permission denied' >&2; exit 1")
    }, "apply")

    expect(hostBlock).not.toContain("sudo option")
  })

  it("should not hint for a failure with other stderr", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.read("echo 'permission denied' >&2; exit 1")
    }, "apply")

    expect(hostBlock).not.toContain("sudo option")
  })

  it("should not hint on a host that didn't fail", async () => {
    const hostRecord = await runNamedHost(
      "a",
      async (h) => {
        await h.inspect(NEEDS_PASSWORD_CMD)
      },
      "apply",
    )

    expect(hostRecord).toMatchObject({ failure: undefined, stepRecords: [{ failureHints: [] }] })
  })
})

describe("formatHostBlock and formatSummary for a warning", () => {
  it("should show a link to a missing path that's already right without --verbose, and count it", async () => {
    const { linkPath, target } = await createBrokenLink()
    const hostRecord = await runNamedHost(
      "a",
      async (h) => {
        await h.link(linkPath, target)
      },
      "plan",
    )

    expect([formatHostBlock(hostRecord), formatSummary([hostRecord], "plan")]).toStrictEqual([
      ["a", `  = unchanged: (link) ${linkPath}`, `      warning: nothing exists at target -> ${target}`].join("\n"),
      "a   unchanged, 1 warning",
    ])
  })

  it("should warn about the state apply left", async () => {
    const directory = await makeTempDir()
    const linkPath = path.join(directory, "link")
    const target = path.join(directory, "missing")
    const hostBlock = await formatBlock(async (h) => {
      await h.link(linkPath, target)
    }, "apply")

    expect(hostBlock?.split("\n").at(-1)).toBe(`      warning: nothing exists at target -> ${target}`)
  })

  it("should count every warning after the change count", async () => {
    const { directory, linkPath, target } = await createBrokenLink()
    const hostRecord = await runNamedHost(
      "a",
      async (h) => {
        await h.link(linkPath, target)
        await h.link(path.join(directory, "new-link"), target)
      },
      "plan",
    )

    expect(formatSummary([hostRecord], "plan").split("\n").at(-1)).toBe("a   1 change, 2 warnings")
  })

  // Skip this as root, because root can write to any directory, so the write wouldn't fail.
  it.skipIf(isRoot)("should give a step that failed no warning", async () => {
    const directory = await makeTempDir()
    const linkPath = path.join(directory, "link")
    await chmod(directory, 0o555)

    try {
      const hostBlock = await formatBlock(async (h) => {
        await h.link(linkPath, path.join(directory, "missing"))
      }, "apply")
      expect(hostBlock).toContain(`  ! failed: (link) ${linkPath}`)
      expect(hostBlock).not.toContain("warning:")
    } finally {
      await chmod(directory, 0o755)
    }
  })
})

describe("formatSummary", () => {
  it("should list each host's status, padded to the longest name, after the plan reminder", async () => {
    const hostRecords = [
      await runNamedHost("caddy", stayRight, "plan"),
      await runNamedHost("immich", failRead, "plan"),
      await runNamedHost("sonarr", changeAndRun, "plan"),
      await runNamedHost("web", changeOnce, "plan"),
    ]

    expect(formatSummary(hostRecords, "plan")).toBe(
      [
        "Steps after a change were checked without that change, so apply may differ.",
        "",
        "caddy    unchanged",
        "immich   failed",
        "sonarr   3 changes",
        "web      1 change",
      ].join("\n"),
    )
  })

  it("should count waiting steps apart from changes", async () => {
    const hostRecords = [await runNamedHost("macbook", waitOnBrew, "plan")]

    expect(formatSummary(hostRecords, "plan").split("\n").at(-1)).toBe("macbook   1 change, 1 waiting")
  })

  it("should leave out the reminder when only runs would run", async () => {
    const hostRecords = [await runNamedHost("a", runOnce, "plan")]

    expect(formatSummary(hostRecords, "plan")).toBe("a   1 change")
  })

  it("should leave out the reminder in apply", async () => {
    const hostRecords = [await runNamedHost("a", runOnce, "apply")]

    expect(formatSummary(hostRecords, "apply")).toBe("a   1 change")
  })
})
