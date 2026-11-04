import { describe, expect, it } from "bun:test"
import { chmod } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { attempt } from "ts-explicit-errors"

import { prepareAndRunHost } from "#__tests__/session.ts"
import type { Mode } from "#cli/program.ts"
import type { HostFunction } from "#hosts/host.ts"
import { host } from "#hosts/host.ts"
import { formatHostBlock, formatSummary } from "#report/format.ts"
import type { EnsureOptions } from "#session/handlers/ensure.ts"
import type { Host } from "#session/session.ts"

const runNamedHost = async (name: string, fn: HostFunction, mode: Mode) =>
  prepareAndRunHost({ name, ...host("@local", fn) }, mode)

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

describe("formatHostBlock", () => {
  it("should mark a changed step with '~' and a ran step with '>' in plan", async () => {
    expect(await formatBlock(changeAndRun, "plan")).toBe("a\n  ~ Write the unit\n  > Reload systemd\n  > Prune")
  })

  it("should mark a ran step with '>' in apply", async () => {
    expect(await formatBlock(runOnce, "apply")).toBe("a\n  > Reload systemd")
  })

  it("should return nothing when every step was already right", async () => {
    expect(await formatBlock(stayRight, "plan")).toBeUndefined()
  })

  it("should show every step with --verbose, a read by its command", async () => {
    expect(await formatVerboseBlock(stayRight)).toBe(
      ["a", "  = Install Caddy", "  · true", "  = Reload systemd"].join("\n"),
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
        "  ~ Install brew packages",
        "  ? Install fish           needs 'Install brew packages'",
        "  ? Install fish plugins   needs 'Install brew packages'",
      ].join("\n"),
    )
  })

  it("should mark a waiting step with '?' and the steps it needs", async () => {
    expect(await formatBlock(waitOnBrew, "plan")).toBe(
      ["a", "  ~ Install brew packages", "  ? Install fish plugins   needs 'Install brew packages'"].join("\n"),
    )
  })

  it("should show a failed step's error on indented lines under it", async () => {
    expect(await formatBlock(failVerify, "apply")).toBe(
      [
        "a",
        "  ! Make it",
        "      the host's state still differs after the fix for step 'Make it'",
        "        got:    exit code 1",
        "        want:   exit code 0",
        "        stderr: missing",
      ].join("\n"),
    )
  })

  it("should name a failed read by its command", async () => {
    expect(await formatBlock(failRead, "plan")).toBe(
      "a\n  ! exit 1\n      failed to read 'exit 1' -> exited with code 1",
    )
  })

  it("should show a failure that isn't any step's after the steps", async () => {
    expect(await formatBlock(changeThenThrow, "plan")).toBe("a\n  ~ Pending\n  ! a.ts\n      boom")
  })

  it("should name a host that couldn't be prepared after its target, and count it as failed", async () => {
    const hostReport = await prepareAndRunHost({ name: "a", ...host("a.lan", changeThenThrow) }, "plan")
    const startError =
      "failed to prepare the host -> failed to read the SSH user's home directory -> target 'a.lan' isn't supported yet (only '@local')"

    expect([formatHostBlock(hostReport), formatSummary([hostReport], "plan")]).toStrictEqual([
      `a\n  ! a.lan\n      ${startError}`,
      "a   failed",
    ])
  })

  it("should show the error from steps run at once under the step that was running", async () => {
    expect(await formatBlock(runStepsAtOnce, "plan")).toBe(
      "a\n  ! First\n      'ensure' can't run while ensure step 'First' is running",
    )
  })

  it("should show a failure the script caught under the step it happened in", async () => {
    expect(await formatBlock(catchFailedExec, "apply")).toBe(
      "a\n  ! Make marker\n      failed to run 'exit 1' -> exited with code 1",
    )
  })

  it("should show a nested step's failure once, under the outer step", async () => {
    expect(await formatBlock(nestStep, "apply")).toBe(
      "a\n  ! Outer\n      failed to run the fix for step 'Outer' -> 'ensure' can't run while ensure step 'Outer' is running",
    )
  })
})

/** Formats the block of an apply whose step still differs after its fix, as the lines under the error. */
const formatFailedCheck = async <T extends string | boolean>(options: EnsureOptions<T>) => {
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

    expect(hostBlock).toBe(["a", "  ~ Start Sonarr", "      got:  'inactive'", "      want: 'active'"].join("\n"))
  })

  it("should show a diff under the step for a multi-line value", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Write the config", { check: String.raw`printf 'a\nb\nc\n'`, want: "a\nB\nc", fix: "true" })
    }, "plan")

    expect(hostBlock).toBe(
      [
        "a",
        "  ~ Write the config",
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
        "  ~ Write the config",
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
    const filePath = path.join(await makeTempDir("format-"), "app.conf")
    await Bun.write(filePath, "port = 8080\nworkers = 4\n")
    await chmod(filePath, 0o600)
    const hostBlock = await formatBlock(async (h) => {
      await h.file(filePath, { content: "port = 8080\nworkers = 8\n", mode: "644" })
    }, "plan")

    expect(hostBlock).toBe(
      [
        "a",
        `  ~ ${filePath}`,
        `      ${"─".repeat(14)}`,
        "      1  port = 8080",
        "        -workers = 4",
        "      2 +workers = 8",
        `      ${"─".repeat(14)}`,
        "      mode: rw------- (600) -> rw-r--r-- (644)",
      ].join("\n"),
    )
  })

  it("should show a note for a new file", async () => {
    const filePath = path.join(await makeTempDir("format-"), "app.conf")
    const hostBlock = await formatBlock(async (h) => {
      await h.file(filePath, { content: "a".repeat(2048) })
    }, "plan")

    expect(hostBlock).toBe(["a", `  ~ ${filePath}`, "      content: new file, 2.05 kB"].join("\n"))
  })

  it("should spell out a size under 1 kB in bytes", async () => {
    const filePath = path.join(await makeTempDir("format-"), "app.conf")
    const hostBlock = await formatBlock(async (h) => {
      await h.file(filePath, { content: "a" })
      await h.file(`${filePath}.new`, { content: "abc" })
    }, "plan")

    expect(hostBlock).toBe(
      [
        "a",
        `  ~ ${filePath}`,
        "      content: new file, 1 byte",
        `  ~ ${filePath}.new`,
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

    expect(lines).toStrictEqual(["        got:    'v1'", "        want:   'v2'", "        stderr: oops"])
  })

  it("should line up a multi-line stderr under its first line", async () => {
    const lines = await formatFailedCheck({ check: "echo one >&2; echo two >&2; false", want: true, fix: "true" })

    expect(lines).toStrictEqual([
      "        got:    exit code 1",
      "        want:   exit code 0",
      "        stderr: one",
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
      "        stderr: warn",
    ])
  })
})

describe("formatSummary", () => {
  it("should list each host's status, padded to the longest name, after the plan reminder", async () => {
    const hostReports = [
      await runNamedHost("caddy", stayRight, "plan"),
      await runNamedHost("immich", failRead, "plan"),
      await runNamedHost("sonarr", changeAndRun, "plan"),
      await runNamedHost("web", changeOnce, "plan"),
    ]

    expect(formatSummary(hostReports, "plan")).toBe(
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
    const hostReports = [await runNamedHost("macbook", waitOnBrew, "plan")]

    expect(formatSummary(hostReports, "plan").split("\n").at(-1)).toBe("macbook   1 change, 1 waiting")
  })

  it("should leave out the reminder when only runs would run", async () => {
    const hostReports = [await runNamedHost("a", runOnce, "plan")]

    expect(formatSummary(hostReports, "plan")).toBe("a   1 change")
  })

  it("should leave out the reminder in apply", async () => {
    const hostReports = [await runNamedHost("a", runOnce, "apply")]

    expect(formatSummary(hostReports, "apply")).toBe("a   1 change")
  })
})
