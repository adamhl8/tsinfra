import { describe, expect, it } from "bun:test"
import { chmod, lstat, mkdir, stat, symlink } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"
import { attempt, err } from "ts-explicit-errors"

import { CONTENT_LIMIT_BYTES } from "#core/__tests__/content.ts"
import {
  UNREACHABLE_TARGET,
  castInvalid,
  createFakeSudoSession,
  createSession,
  createWrappedSession,
  prepareAndRunHost,
  throwBoom,
  loadHostDefinition,
} from "#core/__tests__/session.ts"
import type { HostFunction } from "#core/hosts/host.ts"
import { host } from "#core/hosts/host.ts"
import type { Host } from "#core/session.ts"
import type { EnsureOptions } from "#core/session/handlers/ensure.ts"
import type { Want, WantOf } from "#core/session/handlers/ensure/want.ts"
import type { Exec } from "#core/session/handlers/tools.ts"
import type { HostRecord } from "#core/session/recorder/records.ts"
import type { Mode } from "#mode.ts"
import { renderHostBlock, toShownHostBlock } from "#report.ts"
import { getExitCode } from "#report/exit-code.ts"
import { toHostBlock } from "#report/host-block.ts"
import { renderSummary, hasDrift } from "#report/summary.ts"
import type { Verbosity } from "#report/verbosity.ts"

const runNamedHost = async (name: string, fn: HostFunction, mode: Mode) =>
  prepareAndRunHost(loadHostDefinition(host({ name, target: "@local" }, fn)), mode)

const isRoot = process.getuid?.() === 0

/** Builds a host's block from its record and renders it, as the CLI does. */
const renderRecord = (hostRecord: HostRecord, mode: Mode, verbosity: Verbosity = 0) =>
  renderHostBlock(toShownHostBlock(toHostBlock(hostRecord, mode), verbosity), { verbosity })

/** Builds each host's block from its record and renders their summary, as the CLI does. */
const renderRecordsSummary = (hostRecords: HostRecord[], mode: Mode, verbosity: Verbosity = 0) =>
  renderSummary(
    hostRecords.map((hostRecord) => toShownHostBlock(toHostBlock(hostRecord, mode), verbosity)),
    mode,
  )

const formatBlock = async (fn: HostFunction, mode: Mode) => renderRecord(await runNamedHost("a", fn, mode), mode)

const formatVerboseBlock = async (fn: HostFunction) => renderRecord(await runNamedHost("a", fn, "plan"), "plan", 1)

const changeAndRun = async (h: Host) => {
  const unit = await h.ensure("Write the unit", { want: true, check: "false", fix: "true" })
  await h.run("Reload systemd", "true", { after: [unit] })
  await h.run("Prune", "true", { after: "always" })
}

const runOnce = async (h: Host) => {
  await h.run("Prune", "true", { after: "always" })
}

const stayRight = async (h: Host) => {
  const caddy = await h.ensure("Install Caddy", { want: true, check: "true", fix: "true" })
  await h.read("true")
  await h.run("Reload systemd", "true", { after: [caddy] })
}

const failVerify = async (h: Host) => {
  await h.ensure("Make it", { want: true, check: "echo missing >&2; false", fix: "true" })
}

const waitOnBrew = async (h: Host) => {
  const brew = await h.ensure("Install brew packages", { want: true, check: "false", fix: "true" })
  await h.ensure("Install fish plugins", { needs: [brew], want: true, check: "true", fix: "true" })
}

const waitTwiceOnBrew = async (h: Host) => {
  const brew = await h.ensure("Install brew packages", { want: true, check: "false", fix: "true" })
  await h.ensure("Install fish", { needs: [brew], want: true, check: "true", fix: "true" })
  await h.ensure("Install fish plugins", { needs: [brew], want: true, check: "true", fix: "true" })
}

const failRead = async (h: Host) => {
  await h.read("exit 1")
}

const changeThenThrow = async (h: Host) => {
  await h.ensure("Pending", { want: true, check: "false", fix: "true" })
  throw new Error("boom")
}

const runStepsAtOnce = async (h: Host) => {
  await Promise.allSettled([
    h.ensure("First", { want: true, check: "sleep 0.1", fix: "true" }),
    h.ensure("Second", { want: true, check: "true", fix: "true" }),
  ])
}

const nestStep = async (h: Host) => {
  await h.ensure("Outer", {
    want: true,
    check: "false",
    fix: async () => {
      await h.ensure("Inner", { want: true, check: "true", fix: "true" })
    },
  })
}

const catchFailedExec = async (h: Host) => {
  await h.ensure("Make marker", {
    want: true,
    check: "false",
    fix: async ({ exec }) => {
      await attempt(async () => exec("exit 1"))
    },
  })
}

const changeOnce = async (h: Host) => {
  await h.ensure("Pending", { want: true, check: "false", fix: "true" })
}

const failFix = async (h: Host) => {
  await h.ensure("Make it", { want: "new", check: "echo early >&2; echo old", fix: "exit 1" })
}

const failSecondCompare = async (h: Host) => {
  const marker = path.join(await makeTempDir(), "marker")
  await h.ensure("Make it", {
    want: "new",
    check: async ({ read }) => read(`test ! -f '${marker}' && echo old`),
    fix: `touch '${marker}'`,
  })
}

describe("renderHostBlock", () => {
  it("should mark a changed step with '~' and a ran step with '>' in plan", async () => {
    expect(await formatBlock(changeAndRun, "plan")).toBe(
      "a\n  ~ change: (ensure) Write the unit\n  > triggered: (run) Reload systemd",
    )
  })

  it("should mark a ranAlways step with '>' in apply", async () => {
    expect(await formatBlock(runOnce, "apply")).toBe("a\n  > always: (run) Prune")
  })

  it("should hide a ranAlways step in plan, and show it with -v", async () => {
    const hostRecord = await runNamedHost("a", runOnce, "plan")

    expect([renderRecord(hostRecord, "plan"), renderRecord(hostRecord, "plan", 1)]).toStrictEqual([
      undefined,
      "a\n  > always: (run) Prune",
    ])
  })

  it("should return nothing when every step was already right", async () => {
    expect(await formatBlock(stayRight, "plan")).toBeUndefined()
  })

  it("should show every step with --verbose, a read by its command", async () => {
    expect(await formatVerboseBlock(stayRight)).toBe(
      [
        "a",
        "  = unchanged: (ensure) Install Caddy",
        "  · observed: (read) true",
        "  = unchanged: (run) Reload systemd",
      ].join("\n"),
    )
  })

  it("should give a host with no steps a block by default", async () => {
    expect(
      await formatBlock(async () => {
        /* empty */
      }, "plan"),
    ).toBe(["a", "  no steps"].join("\n"))
  })

  it("should show a failure thrown before any step, not no steps", async () => {
    expect(await formatBlock(throwBoom, "plan")).toBe(
      "a\n  ! failed: (host fn)\n      boom\n        thrown in the host function, outside any step",
    )
  })

  it("should put each waiting step's note after its own name, not in a column", async () => {
    expect(await formatBlock(waitTwiceOnBrew, "plan")).toBe(
      [
        "a",
        "  ~ change: (ensure) Install brew packages",
        "  ? waiting: (ensure) Install fish   needs 'Install brew packages'",
        "  ? waiting: (ensure) Install fish plugins   needs 'Install brew packages'",
      ].join("\n"),
    )
  })

  it("should mark a waiting step with '?' and the steps it needs", async () => {
    expect(await formatBlock(waitOnBrew, "plan")).toBe(
      [
        "a",
        "  ~ change: (ensure) Install brew packages",
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
        "        got:     exit code 1",
        "        want:    exit code 0",
        "        command: echo missing >&2; false",
        "        stderr:  missing",
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
      "a\n  ~ change: (ensure) Pending\n  ! failed: (host fn)\n      boom\n        thrown in the host function, outside any step",
    )
  })

  it("should name a host that couldn't be prepared after its target, and count it as failed", async () => {
    const hostRecord = await prepareAndRunHost(
      loadHostDefinition(host({ name: "a", target: UNREACHABLE_TARGET }, changeThenThrow)),
      "plan",
    )
    const startError =
      "failed to read the ssh config for 'unreachable host' -> exited with code 255: hostname contains invalid characters"

    expect([renderRecord(hostRecord, "plan"), renderRecordsSummary([hostRecord], "plan")]).toStrictEqual([
      `a\n  ! failed: (preparation) ${UNREACHABLE_TARGET}\n      ${startError}`,
      "a   failed",
    ])
  })

  it("should show a hint under a host that couldn't be prepared", () => {
    const hostBlock = renderRecord(
      {
        name: "a",
        target: "a.lan",
        preparationCommands: [],
        runningStep: undefined,
        stepRecords: [],
        failure: {
          kind: "preparation",
          error: new Error("Host key verification failed."),
          hints: [{ kind: "unknownHostKey", target: "a.lan" }],
        },
      },
      "plan",
    )

    expect(hostBlock).toBe(
      [
        "a",
        "  ! failed: (preparation) a.lan",
        "      Host key verification failed.",
        "        run 'ssh a.lan' once to check the host's key and save it",
      ].join("\n"),
    )
  })

  it("should show a saved state failure with its note, after every step ran", () => {
    const hostBlock = renderRecord(
      {
        name: "a",
        target: "a.lan",
        preparationCommands: [],
        runningStep: undefined,
        stepRecords: [],
        failure: {
          kind: "saved state",
          error: new Error("failed to delete the saved state in '/home/a/.tsinfra/state/a.json'"),
          hints: [],
        },
      },
      "apply",
    )

    expect(hostBlock).toBe(
      [
        "a",
        "  ! failed: (saved state) a.lan",
        "      failed to delete the saved state in '/home/a/.tsinfra/state/a.json'",
        "        every step ran, but tsinfra couldn't clear its saved state on the host, so the next apply shows the steps that changed as 'resume', and they still read as changed to the script",
      ].join("\n"),
    )
  })

  it("should show the hint for a host key that changed", () => {
    const hostBlock = renderRecord(
      {
        name: "a",
        target: "a.lan",
        preparationCommands: [],
        runningStep: undefined,
        stepRecords: [],
        failure: { kind: "preparation", error: new Error("failed"), hints: [{ kind: "changedHostKey" }] },
      },
      "plan",
    )

    expect(hostBlock?.split("\n").at(-1)).toBe(
      "        if the host was recreated, remove its old key from the known_hosts line named above",
    )
  })

  it("should list the commands preparation ran under its failure with -vv, by their labels", async () => {
    const hostRecord = await prepareAndRunHost(
      loadHostDefinition(host({ name: "a", target: UNREACHABLE_TARGET }, changeThenThrow)),
      "plan",
    )

    expect([
      renderRecord(hostRecord, "plan", 1)?.split("\n").length,
      renderRecord(hostRecord, "plan", 2)?.split("\n").slice(3),
    ]).toStrictEqual([3, ["        commands:", "          $ <ssh config>"]])
  })

  it("should list preparation's commands before its hint", () => {
    const hostBlock = renderRecord(
      {
        name: "a",
        target: "a.lan",
        preparationCommands: [
          { cmd: "ssh -G -T -- a.lan", label: "ssh config" },
          { cmd: String.raw`printf '%s\n' "$HOME"`, label: "home directory" },
        ],
        runningStep: undefined,
        stepRecords: [],
        failure: {
          kind: "preparation",
          error: new Error("Host key verification failed."),
          hints: [{ kind: "unknownHostKey", target: "a.lan" }],
        },
      },
      "plan",
      2,
    )

    expect(hostBlock?.split("\n").slice(3)).toStrictEqual([
      "        commands:",
      "          $ <ssh config>",
      "          $ <home directory>",
      "        run 'ssh a.lan' once to check the host's key and save it",
    ])
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
const formatFailedCheck = async <T extends WantOf<T>>(options: EnsureOptions<T>) => {
  const hostBlock = await formatBlock(async (h) => {
    await h.ensure("Make it", options)
  }, "apply")
  return hostBlock?.split("\n").slice(3)
}

const numberedLines = (prefix: string) => Array.from({ length: 20_000 }, (_, index) => `${prefix}${index}`)

describe("renderHostBlock for a step that would change a string", () => {
  it("should show got and want under the step for a single-line value", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Start Sonarr", { want: "active", check: "echo inactive", fix: "true" })
    }, "plan")

    expect(hostBlock).toBe(
      ["a", "  ~ change: (ensure) Start Sonarr", "      got:  inactive", "      want: active"].join("\n"),
    )
  })

  it("should show only the lines that differ, as got and want, for a multi-line value", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Write the config", { want: "a\nB\nc", check: String.raw`printf 'a\nb\nc\n'`, fix: "true" })
    }, "plan")

    expect(hostBlock).toBe(["a", "  ~ change: (ensure) Write the config", "      got:  b", "      want: B"].join("\n"))
  })

  it("should line up each differing line under the first, and show an empty want as a marker", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Upgrade packages", { want: "", check: String.raw`printf 'fd\nripgrep\n'`, fix: "true" })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      got:  fd", "            ripgrep", "      want: ''"])
  })

  it("should leave out the row of a side whose lines are all in the other", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Install packages", { want: "fd\njq\nripgrep", check: String.raw`printf 'fd\njq\n'`, fix: "true" })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      want: ripgrep"])
  })

  it("should show a differing empty line as a marker", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Write the config", { want: "a\nb", check: String.raw`printf 'a\n\nb\n'`, fix: "true" })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      got: ''"])
  })

  it("should quote a value with whitespace at either end, and only that value", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Start Sonarr", { want: "active", check: "printf 'active '", fix: "true" })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      got:  'active '", "      want: active"])
  })

  it("should quote a line of only whitespace", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Write the config", { want: "a\nb", check: String.raw`printf 'a\n  \nb\n'`, fix: "true" })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      got: '  '"])
  })

  it("should show a note for more than 15 differing lines, and every line with --verbose", async () => {
    const lines = Array.from({ length: 16 }, (_, index) => `pkg${index}`)
    const upgrade = async (h: Host) => {
      await h.ensure("Upgrade packages", { want: "", check: `printf '%s\\n' ${lines.join(" ")}`, fix: "true" })
    }

    const hostBlock = await formatBlock(upgrade, "plan")
    const verboseLines = (await formatVerboseBlock(upgrade))?.split("\n").slice(2)

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      16 lines differ, run with --verbose to see them"])
    expect([verboseLines?.length, verboseLines?.at(-1)]).toStrictEqual([17, "      want: ''"])
  })

  it("should show a note when the lines take too long to compare", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Write the config", {
        want: numberedLines("b").join("\n"),
        // Print the lines with `awk`, because BusyBox's `seq` has no `-f`.
        check: "awk 'BEGIN { for (i = 0; i < 20000; i++) print \"a\" i }'",
        fix: "true",
      })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([
      "      values took too long to compare, run with -vv to see them",
    ])
  })
})

describe("renderHostBlock for a step that would change a list", () => {
  it("should show a reorder as the item leaving one place and arriving in another", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Set the search domains", {
        want: ["lan", "home.arpa"],
        check: String.raw`printf 'home.arpa\nlan\n'`,
        fix: "true",
      })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([
      "      ──────────",
      "      -home.arpa",
      "       lan",
      "      +home.arpa",
      "      ──────────",
    ])
  })

  it("should show an added and a removed item, each with one unchanged item around it", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Set the items", {
        want: ["a", "b", "new", "c", "d", "f"],
        check: String.raw`printf 'a\nb\nc\nd\ne\nf\n'`,
        fix: "true",
      })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([
      "      ────",
      "       b",
      "      +new",
      "       c",
      "       d",
      "      -e",
      "       f",
      "      ────",
    ])
  })

  it("should split changes far apart into hunks, with a rule between them", async () => {
    const items = Array.from({ length: 12 }, (_, index) => `i${index}`)
    const wantItems = items.with(1, "I1").with(10, "I10")
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Set the items", { want: wantItems, check: `printf '%s\\n' ${items.join(" ")}`, fix: "true" })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([
      "      ────",
      "       i0",
      "      -i1",
      "      +I1",
      "       i2",
      "      ────",
      "       i9",
      "      -i10",
      "      +I10",
      "       i11",
      "      ────",
    ])
  })

  it("should show each item by the value rules, like an empty item and one with a trailing space", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Set the items", {
        want: ["a", "", "b"],
        check: async ({ read }) => [await read("echo a"), "b "],
        fix: "true",
      })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([
      "      ─────",
      "       a",
      "      -'b '",
      "      +''",
      "      +b",
      "      ─────",
    ])
  })

  it("should show a note for a diff longer than 15 lines, and the full diff with --verbose", async () => {
    const items = Array.from({ length: 16 }, (_, index) => `pkg${index}`)
    const upgrade = async (h: Host) => {
      await h.ensure("Upgrade packages", { want: ["new"], check: `printf '%s\\n' ${items.join(" ")}`, fix: "true" })
    }

    const hostBlock = await formatBlock(upgrade, "plan")
    const verboseLines = (await formatVerboseBlock(upgrade))?.split("\n").slice(2)

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      long diff (17 lines), run with --verbose to see it"])
    expect([verboseLines?.length, verboseLines?.[1]]).toStrictEqual([19, "      -pkg0"])
  })
})

// Read `key=value` lines into a record, the shape a record check returns.
const readRecord = async (read: Exec, lines: string) =>
  Object.fromEntries(
    (await read(`printf '%s\\n' ${lines}`)).split("\n").map((line) => {
      const [key = "", value = ""] = line.split("=")
      return [key, value] as const
    }),
  )

describe("renderHostBlock for a dir step", () => {
  it("should name the step by its path, with an exists row", async () => {
    const dirPath = path.join(await makeTempDir(), "made")
    const makeDir = async (h: Host) => {
      await h.dir(dirPath)
    }

    expect(await formatBlock(makeDir, "plan")).toBe(
      ["a", `  ~ change: (dir) ${dirPath}`, "      exists: false -> true"].join("\n"),
    )
  })

  it("should show a row for each attribute that differs, and (none) for a missing directory", async () => {
    const directory = await makeTempDir()
    await chmod(directory, 0o700)
    const missingPath = path.join(directory, "made")
    const makeDirs = async (h: Host) => {
      await h.dir(directory, { mode: "750" })
      await h.dir(missingPath, { mode: "750", group: "web" })
    }

    expect(await formatBlock(makeDirs, "plan")).toBe(
      [
        "a",
        `  ~ change: (dir) ${directory}`,
        "      mode: rwx------ (700) -> rwxr-x--- (750)",
        `  ~ change: (dir) ${missingPath}`,
        "      exists: false -> true",
        "      mode:   (none) -> rwxr-x--- (750)",
        "      group:  (none) -> web",
      ].join("\n"),
    )
  })

  it("should list its labeled commands from -vv", async () => {
    const dirPath = path.join(await makeTempDir(), "made")
    const makeDir = async (h: Host) => {
      await h.dir(dirPath)
    }

    expect(renderRecord(await runNamedHost("a", makeDir, "apply"), "apply", 2)).toBe(
      [
        "a",
        `  ~ change: (dir) ${dirPath}`,
        "      exists: false -> true",
        "      commands:",
        "        $ <directory details script>",
        "        $ <directory write script>",
        "        $ <directory details script>",
      ].join("\n"),
    )
  })
})

describe("renderHostBlock for a step that would change a set", () => {
  it("should show missing items, then extra ones, each in the order its side lists them", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Install packages", {
        want: new Set(["jq", "fd", "rg"]),
        check: String.raw`printf 'zsh\nfd\nbat\n'`,
        fix: "true",
      })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([
      "      missing: jq",
      "               rg",
      "      extra:   zsh",
      "               bat",
    ])
  })

  it("should leave out the row of a side with no items", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Install packages", {
        want: new Set(["fd"]),
        check: String.raw`printf 'fd\nrg\nzsh\n'`,
        fix: "true",
      })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      extra: rg", "             zsh"])
  })

  it("should leave out the extra row when the check found only what want has", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Install packages", { want: new Set(["fd", "rg"]), check: "echo fd", fix: "true" })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      missing: rg"])
  })

  it("should show each item by the value rules, like an item with a trailing space quoted", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Install packages", { want: new Set(["fd"]), check: String.raw`printf 'fd \n'`, fix: "true" })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      missing: fd", "      extra:   'fd '"])
  })

  it("should show a note for more than 15 differing items, and every item with --verbose", async () => {
    const items = Array.from({ length: 16 }, (_, index) => `pkg${index}`)
    const upgrade = async (h: Host) => {
      await h.ensure("Upgrade packages", {
        want: new Set(["new"]),
        check: `printf '%s\\n' ${items.join(" ")}`,
        fix: "true",
      })
    }

    const hostBlock = await formatBlock(upgrade, "plan")
    const verboseLines = (await formatVerboseBlock(upgrade))?.split("\n").slice(2)

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      17 items differ, run with --verbose to see them"])
    expect([verboseLines?.length, verboseLines?.[0], verboseLines?.[1]]).toStrictEqual([
      17,
      "      missing: new",
      "      extra:   pkg0",
    ])
  })
})

/** Returns the rows a record `want` shows against a check that returns `got`. */
const formatRecordRows = async (want: Want, got: unknown) =>
  (
    await formatBlock(async (h) => {
      await h.ensure("Configure the app", { want, check: () => castInvalid(got), fix: "true" })
    }, "plan")
  )
    ?.split("\n")
    .slice(2)

describe("renderHostBlock for a step with an empty want", () => {
  it("should show what the check found against an empty list, with no diff marks", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Upgrade packages", { want: [], check: String.raw`printf 'fd\nrg\n'`, fix: "true" })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      found: fd", "             rg"])
  })

  it("should show what the check found against an empty set the same way", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Upgrade packages", { want: new Set(), check: String.raw`printf 'fd\nrg\n'`, fix: "true" })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      found: fd", "             rg"])
  })

  it("should show each found item by the value rules, like an empty one", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Upgrade packages", {
        want: [],
        check: async ({ read }) => ["", await read("echo rg")],
        fix: "true",
      })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      found: ''", "             rg"])
  })

  it("should show what the check found against an empty record as its keys under a heading", async () => {
    const rows = await formatRecordRows({}, { typescript: "5.9.2", port: 8080, env: { TZ: "UTC" } })

    expect(rows).toStrictEqual([
      "      found:",
      "        typescript: 5.9.2",
      "        port:       8080",
      '        env:        {"TZ":"UTC"}',
    ])
  })

  it("should show a note for more than 15 found items, and every item with --verbose", async () => {
    const items = Array.from({ length: 16 }, (_, index) => `pkg${index}`)
    const upgrade = async (h: Host) => {
      await h.ensure("Upgrade packages", { want: [], check: `printf '%s\\n' ${items.join(" ")}`, fix: "true" })
    }

    const hostBlock = await formatBlock(upgrade, "plan")
    const verboseLines = (await formatVerboseBlock(upgrade))?.split("\n").slice(2)

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      16 items found, run with --verbose to see them"])
    expect([verboseLines?.length, verboseLines?.[0]]).toStrictEqual([16, "      found: pkg0"])
  })

  it("should show a note for more than 15 lines of found keys, which counts the keys", async () => {
    const got = Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`key${index}`, index]))
    const rows = await formatRecordRows({}, got)

    expect(rows).toStrictEqual(["      15 keys found, run with --verbose to see them"])
  })
})

describe("renderHostBlock for a step that would change a record", () => {
  it("should show a row per key that differs, in want's order, then the extra keys, with (none) for an absent side", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Sync versions", {
        want: { zx: "8.8.1", pnpm: "11.2.0", fd: "10.0.0" },
        check: async ({ read }) => readRecord(read, "typescript=5.9.2 pnpm=11.1.0 fd=10.0.0"),
        fix: "true",
      })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([
      "      zx:         (none) -> 8.8.1",
      "      pnpm:       11.1.0 -> 11.2.0",
      "      typescript: 5.9.2 -> (none)",
    ])
  })

  it("should show numbers and booleans in a record's rows", async () => {
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Configure the server", {
        want: { port: 8080, enabled: true },
        check: async ({ read }) => ({
          port: Number(await read("echo 80")),
          enabled: (await read("echo no")) === "yes",
        }),
        fix: "true",
      })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      port:    80 -> 8080", "      enabled: false -> true"])
  })

  it("should show a note for more than 15 differing keys, and every key with --verbose", async () => {
    const want = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`key${index}`, "new"]))
    const sync = async (h: Host) => {
      await h.ensure("Sync versions", { want, check: async ({ read }) => readRecord(read, "other=1"), fix: "true" })
    }

    const hostBlock = await formatBlock(sync, "plan")
    const verboseLines = (await formatVerboseBlock(sync))?.split("\n").slice(2)

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      17 keys differ, run with --verbose to see them"])
    expect([verboseLines?.length, verboseLines?.at(-1)]).toStrictEqual([17, "      other: 1 -> (none)"])
  })

  it("should show a nested record's keys under a heading, each level lined up on its own", async () => {
    const rows = await formatRecordRows(
      { image: "sonarr:4.0.15", env: { TZ: "America/New_York", PUID: 1000 }, labels: { "traefik.enable": true } },
      { image: "sonarr:4.0.14", env: { TZ: "UTC" } },
    )

    expect(rows).toStrictEqual([
      "      image: sonarr:4.0.14 -> sonarr:4.0.15",
      "      env:",
      "        TZ:   UTC -> America/New_York",
      "        PUID: (none) -> 1000",
      "      labels:",
      "        traefik.enable: (none) -> true",
    ])
  })

  it("should show a heading per level for one deep change", async () => {
    const rows = await formatRecordRows({ a: { b: { c: 1 } }, d: "same" }, { a: { b: { c: 2 } }, d: "same" })

    expect(rows).toStrictEqual(["      a:", "        b:", "          c: 2 -> 1"])
  })

  it("should leave a heading out of the column the other rows line up in", async () => {
    const rows = await formatRecordRows({ environment: { TZ: "UTC" }, id: 1 }, { environment: { TZ: "GMT" }, id: 2 })

    expect(rows).toStrictEqual(["      environment:", "        TZ: GMT -> UTC", "      id: 2 -> 1"])
  })

  it("should show a nested record's keys in want's order, then the extra ones", async () => {
    const rows = await formatRecordRows({ env: { b: "1", c: "3" } }, { env: { a: "x", b: "2" } })

    expect(rows).toStrictEqual(["      env:", "        b: 2 -> 1", "        c: (none) -> 3", "        a: x -> (none)"])
  })

  it("should show two kinds of value at one key, null, and an empty record on one row each", async () => {
    // oxlint-disable-next-line unicorn/no-null - a record want can hold null
    const rows = await formatRecordRows({ a: { b: "1" }, c: null, d: {} }, { a: "1", c: { x: 1 } })

    expect(rows).toStrictEqual(['      a: 1 -> {"b":"1"}', '      c: {"x":1} -> null', "      d: (none) -> {}"])
  })

  it("should show an empty key and one with whitespace at its edge by the string rules", async () => {
    const rows = await formatRecordRows({ "": "a", " padded ": 1 }, {})

    expect(rows).toStrictEqual(["      '':         (none) -> a", "      ' padded ': (none) -> 1"])
  })

  it("should count a nested record's lines toward the note, which counts the top-level keys", async () => {
    const env = Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`KEY${index}`, "new"]))
    const sync = async (h: Host) => {
      await h.ensure("Set the env", { want: { env }, check: () => castInvalid({ env: {} }), fix: "true" })
    }

    const hostBlock = await formatBlock(sync, "plan")
    const verboseLines = (await formatVerboseBlock(sync))?.split("\n").slice(2)

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      1 key differs, run with --verbose to see them"])
    expect([verboseLines?.length, verboseLines?.[0], verboseLines?.[1]]).toStrictEqual([
      16,
      "      env:",
      "        KEY0:  (none) -> new",
    ])
  })
})

describe("renderHostBlock for a step that would change a nested list or set", () => {
  it("should show a nested list's diff under its key, with no rule around it", async () => {
    const rows = await formatRecordRows(
      { image: "sonarr:4.0.15", ports: ["80:80", "8990:8989"] },
      { image: "sonarr:4.0.14", ports: ["80:80", "8989:8989"] },
    )

    expect(rows).toStrictEqual([
      "      image: sonarr:4.0.14 -> sonarr:4.0.15",
      "      ports:",
      "         80:80",
      "        -8989:8989",
      "        +8990:8989",
    ])
  })

  it("should show a reorder and an insert in a nested list", async () => {
    const rows = await formatRecordRows({ order: ["a", "b", "c", "new"] }, { order: ["b", "a", "c"] })

    expect(rows).toStrictEqual(["      order:", "        -b", "         a", "        +b", "         c", "        +new"])
  })

  it("should split far-apart changes in a nested list into hunks, with a rule only between them", async () => {
    const items = Array.from({ length: 12 }, (_, index) => `i${index}`)
    const rows = await formatRecordRows({ items: items.with(1, "I1").with(10, "I10") }, { items })

    expect(rows).toStrictEqual([
      "      items:",
      "         i0",
      "        -i1",
      "        +I1",
      "         i2",
      "        ────",
      "         i9",
      "        -i10",
      "        +I10",
      "         i11",
    ])
  })

  it("should show a changed object in a nested list as one line on each side", async () => {
    const rows = await formatRecordRows(
      {
        rules: [
          { port: 80, allow: true },
          { port: 443, allow: true },
        ],
      },
      {
        rules: [
          { port: 80, allow: true },
          { port: 443, allow: false },
        ],
      },
    )

    expect(rows).toStrictEqual([
      "      rules:",
      '         {"port":80,"allow":true}',
      '        -{"port":443,"allow":false}',
      '        +{"port":443,"allow":true}',
    ])
  })

  it("should show a nested set's missing and extra items under its key", async () => {
    const rows = await formatRecordRows(
      { packages: { formula: new Set(["fd", "jq"]), cask: new Set(["signal"]) } },
      { packages: { formula: new Set(["jq", "rg"]), cask: new Set(["signal"]) } },
    )

    expect(rows).toStrictEqual([
      "      packages:",
      "        formula:",
      "          missing: fd",
      "          extra:   rg",
    ])
  })

  it("should show a list or a set that only one side has as all added or removed items", async () => {
    const rows = await formatRecordRows({ tags: ["web", "media"] }, { groups: new Set([1000, 1001]) })

    expect(rows).toStrictEqual([
      "      tags:",
      "        +web",
      "        +media",
      "      groups:",
      "        extra: 1000",
      "               1001",
    ])
  })

  it("should show a set against a list, and an empty list or set against an absent side, on one row", async () => {
    const rows = await formatRecordRows({ a: new Set(["x"]), b: [], c: new Set() }, { a: ["x"] })

    expect(rows).toStrictEqual(['      a: ["x"] -> Set ["x"]', "      b: (none) -> []", "      c: (none) -> Set []"])
  })

  it("should show a set inside a nested list's item as Set and its items", async () => {
    const rows = await formatRecordRows(
      { users: [{ name: "alice", groups: new Set(["wheel"]) }] },
      { users: [{ name: "alice", groups: new Set(["staff"]) }] },
    )

    expect(rows).toStrictEqual([
      "      users:",
      '        -{"name":"alice","groups":Set ["staff"]}',
      '        +{"name":"alice","groups":Set ["wheel"]}',
    ])
  })

  it("should count a nested list's lines toward the note, which counts the top-level keys", async () => {
    const ports = Array.from({ length: 15 }, (_, index) => `${8000 + index}:80`)
    const sync = async (h: Host) => {
      await h.ensure("Set the ports", { want: { ports }, check: () => castInvalid({ ports: [] }), fix: "true" })
    }

    const hostBlock = await formatBlock(sync, "plan")
    const verboseLines = (await formatVerboseBlock(sync))?.split("\n").slice(2)

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      1 key differs, run with --verbose to see them"])
    expect([verboseLines?.length, verboseLines?.[0], verboseLines?.[1]]).toStrictEqual([
      16,
      "      ports:",
      "        +8000:80",
    ])
  })

  it("should count a nested set's lines toward the note", async () => {
    const packages = new Set(Array.from({ length: 15 }, (_, index) => `pkg${index}`))
    const sync = async (h: Host) => {
      await h.ensure("Install packages", {
        want: { packages },
        check: () => castInvalid({ packages: new Set() }),
        fix: "true",
      })
    }

    const hostBlock = await formatBlock(sync, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual(["      1 key differs, run with --verbose to see them"])
  })
})

describe("renderHostBlock for a file step", () => {
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

  it("should number lines by want, leave removed lines unnumbered, and rule off each hunk", async () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)
    const wanted = [...lines.slice(0, -1), "line twenty"]
    wanted[0] = "line one"
    const filePath = path.join(await makeTempDir(), "app.conf")
    await bun.write(filePath, `${lines.join("\n")}\n`)
    const hostBlock = await formatBlock(async (h) => {
      await h.file(filePath, `${wanted.join("\n")}\n`)
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([
      `      ${"─".repeat(15)}`,
      "         -line 1",
      "       1 +line one",
      "       2  line 2",
      `      ${"─".repeat(15)}`,
      "      19  line 19",
      "         -line 20",
      "      20 +line twenty",
      `      ${"─".repeat(15)}`,
    ])
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
    const hostBlock = renderRecord(hostSession.hostRecord, "plan")

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

  it("should quote a missing target with whitespace at either end, in its row and its warning", async () => {
    const directory = await makeTempDir()
    const linkPath = path.join(directory, "link")
    const target = path.join(directory, "target ")
    const hostBlock = await formatBlock(async (h) => {
      await h.link(linkPath, target)
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([
      `      target: new link to '${target}'`,
      `      warning: nothing exists at target -> '${target}'`,
    ])
  })

  it("should quote a link target with whitespace at either end", async () => {
    const directory = await makeTempDir()
    const linkPath = path.join(directory, "link")
    await symlink("/old ", linkPath)
    const hostBlock = await formatBlock(async (h) => {
      await h.link(linkPath, directory)
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([`      target: '/old ' -> ${directory}`])
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
    const hostBlock = renderRecord(hostSession.hostRecord, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([
      `      target: /old -> ${directory}`,
      `      user:   ${uid} -> ${uid + 1}`,
    ])
  })

  it("should show a change to only a link's target mode, in both notations", async () => {
    const directory = await makeTempDir()
    const linkPath = path.join(directory, "link")
    const target = path.join(directory, "target")
    await bun.write(target, "a\n")
    await chmod(target, 0o644)
    await symlink(target, linkPath)
    const hostBlock = await formatBlock(async (h) => {
      await h.link(linkPath, target, { targetAttributes: { mode: "600" } })
    }, "plan")

    expect(hostBlock).toBe(
      ["a", `  ~ change: (link) ${linkPath}`, "      target mode: rw-r--r-- (644) -> rw------- (600)"].join("\n"),
    )
  })

  it("should show a link's target mode after its target, lined up", async () => {
    const directory = await makeTempDir()
    const linkPath = path.join(directory, "link")
    const target = path.join(directory, "target")
    await bun.write(target, "a\n")
    await chmod(target, 0o644)
    await symlink("/old", linkPath)
    const hostBlock = await formatBlock(async (h) => {
      await h.link(linkPath, target, { targetAttributes: { mode: "600" } })
    }, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([
      `      target:      /old -> ${target}`,
      "      target mode: rw-r--r-- (644) -> rw------- (600)",
    ])
  })

  it("should show a link's target user with its prefix", async () => {
    const directory = await makeTempDir()
    const linkPath = path.join(directory, "link")
    const target = path.join(directory, "target")
    await bun.write(target, "a\n")
    await symlink(target, linkPath)
    const { uid } = await stat(target)
    const { hostSession } = await createFakeSudoSession("plan")
    await hostSession.host.link(linkPath, target, { sudo: true, targetAttributes: { user: uid + 1 } })
    const hostBlock = renderRecord(hostSession.hostRecord, "plan")

    expect(hostBlock?.split("\n").slice(2)).toStrictEqual([`      target user: ${uid} -> ${uid + 1}`])
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

describe("renderHostBlock for a host state that still differs after the fix", () => {
  it("should show the exit codes when a want: false check still exits 0", async () => {
    expect(await formatFailedCheck({ want: false, check: "true", fix: "true" })).toStrictEqual([
      "        got:  exit code 0",
      "        want: a non-zero exit code",
    ])
  })

  it("should show the booleans a function check compared", async () => {
    const lines = await formatFailedCheck({
      want: true,
      check: async ({ read }) => (await read("echo no")) === "yes",
      fix: "true",
    })

    expect(lines).toStrictEqual(["        got:  false", "        want: true"])
  })

  it("should show both values of a string check", async () => {
    expect(await formatFailedCheck({ want: "v2", check: "echo v1", fix: "true" })).toStrictEqual([
      "        got:  v1",
      "        want: v2",
    ])
  })

  it("should show an empty value as a marker", async () => {
    expect(await formatFailedCheck({ want: "v2", check: "true", fix: "true" })).toStrictEqual([
      "        got:  ''",
      "        want: v2",
    ])
  })

  it("should show stderr when a string check exits non-zero", async () => {
    const lines = await formatFailedCheck({ want: "v2", check: "echo v1; echo oops >&2; exit 3", fix: "true" })

    expect(lines).toStrictEqual([
      "        got:     v1",
      "        want:    v2",
      "        command: echo v1; echo oops >&2; exit 3",
      "        stderr:  oops",
    ])
  })

  it("should line up a multi-line stderr under its first line", async () => {
    const lines = await formatFailedCheck({ want: true, check: "echo one >&2; echo two >&2; false", fix: "true" })

    expect(lines).toStrictEqual([
      "        got:     exit code 1",
      "        want:    exit code 0",
      "        command: echo one >&2; echo two >&2; false",
      "        stderr:  one",
      "                 two",
    ])
  })

  it("should leave the empty lines out of a multi-line stderr", async () => {
    const lines = await formatFailedCheck({
      want: true,
      check: "echo one >&2; echo >&2; echo two >&2; false",
      fix: "true",
    })

    expect(lines).toStrictEqual([
      "        got:     exit code 1",
      "        want:    exit code 0",
      "        command: echo one >&2; echo >&2; echo two >&2; false",
      "        stderr:  one",
      "                 two",
    ])
  })

  it("should show a multi-line value's differing lines lined up with its stderr", async () => {
    const check = String.raw`printf 'a\nb\n'; echo warn >&2`
    const lines = await formatFailedCheck({ want: "a\nc", check, fix: "true" })

    expect(lines).toStrictEqual([
      "        got:     b",
      "        want:    c",
      `        command: ${check}`,
      "        stderr:  warn",
    ])
  })
})

/**
 * Creates a session where every command writes to stderr, and `filePath` changes right after a write, so it still
 * differs.
 */
const createNoisySession = async (filePath: string) =>
  createWrappedSession("apply", (transport) => async (cmd) => {
    const output = await transport(`echo noise >&2\n${cmd}`)
    if (cmd.includes("mv -f")) await bun.write(filePath, "changed\n")
    return output
  })

describe("renderHostBlock for the stderr of a step that still differs", () => {
  const AFTER_FIX_NOTE = "        some commands after the fix wrote to stderr, run with -vvv to see what they printed"
  const DURING_FIX_NOTE = "        some commands during the fix wrote to stderr, run with -vvv to see what they printed"

  it("should show nothing extra when no command wrote to stderr", async () => {
    const lines = await formatFailedCheck({ want: true, check: "false", fix: "true" })

    expect(lines).toStrictEqual(["        got:  exit code 1", "        want: exit code 0"])
  })

  it("should show the stderr of a check that exits 0", async () => {
    const check = "echo warn >&2"
    const lines = await formatFailedCheck({ want: "x", check, fix: "true" })

    expect(lines?.slice(-2)).toStrictEqual([`        command: ${check}`, "        stderr:  warn"])
  })

  it("should show a fix's stderr, then the check's, each with its command", async () => {
    const fix = "echo ignored >&2"
    const check = "echo warn >&2; false"
    const lines = await formatFailedCheck({ want: true, check, fix })

    expect(lines?.slice(2)).toStrictEqual([
      `        command: ${fix}`,
      "        stderr:  ignored",
      `        command: ${check}`,
      "        stderr:  warn",
    ])
  })

  it("should show the stderr of a check function that runs one command", async () => {
    const cmd = "echo refused >&2; exit 7"
    const lines = await formatFailedCheck({
      want: true,
      check: async ({ inspect }) => (await inspect(cmd)).exitCode === 0,
      fix: "true",
    })

    expect(lines).toStrictEqual([
      "        got:     false",
      "        want:    true",
      `        command: ${cmd}`,
      "        stderr:  refused",
    ])
  })

  it("should show the note for a check function that runs several commands", async () => {
    const lines = await formatFailedCheck({
      want: true,
      check: async ({ inspect }) => {
        await inspect("echo warn >&2")
        await inspect("true")
        return false
      },
      fix: "true",
    })

    expect(lines).toStrictEqual(["        got:  false", "        want: true", AFTER_FIX_NOTE])
  })

  it("should show nothing extra when several commands wrote no stderr", async () => {
    const lines = await formatFailedCheck({
      want: true,
      check: async ({ inspect }) => {
        await inspect("true")
        await inspect("true")
        return false
      },
      fix: "true",
    })

    expect(lines).toStrictEqual(["        got:  false", "        want: true"])
  })

  it("should leave the notes out with -vvv, where each command's stderr shows under it", async () => {
    const hostRecord = await runNamedHost(
      "a",
      async (h) => {
        await h.ensure("Make it", {
          want: true,
          check: async ({ inspect }) => {
            await inspect("echo warn >&2")
            await inspect("true")
            return false
          },
          fix: "true",
        })
      },
      "apply",
    )

    expect(renderRecord(hostRecord, "apply", 2)).toContain("run with -vvv to see what they printed")
    const verboseBlock = renderRecord(hostRecord, "apply", 3)
    expect(verboseBlock).not.toContain("run with -vvv")
    expect(verboseBlock).toContain("stderr: warn")
  })

  it("should show a note for each phase that ran several commands", async () => {
    const lines = await formatFailedCheck({
      want: true,
      check: async ({ inspect }) => {
        await inspect("echo warn >&2")
        await inspect("true")
        return false
      },
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
      want: true,
      check: async ({ inspect }) => {
        await inspect("echo warn >&2")
        await inspect("true")
        return false
      },
      fix,
    })

    expect(lines?.slice(2)).toStrictEqual([`        command: ${fix}`, "        stderr:  ignored", AFTER_FIX_NOTE])
  })

  it("should leave out the stderr from before the fix", async () => {
    const marker = path.join(await makeTempDir(), "marker")
    const lines = await formatFailedCheck({
      want: "new",
      check: `test -f '${marker}' || echo early >&2; echo old`,
      fix: `touch '${marker}'`,
    })

    expect(lines).toStrictEqual(["        got:  old", "        want: new"])
  })

  it("should leave out the stderr of commands tsinfra wrote itself", async () => {
    const filePath = path.join(await makeTempDir(), "app.conf")
    const hostSession = await createNoisySession(filePath)
    await attempt(async () => hostSession.host.file(filePath, "a\n"))

    const hostBlock = renderRecord(hostSession.hostRecord, "apply")

    expect(hostBlock).toContain("the host's state still differs after the fix")
    expect(hostBlock).not.toContain("noise")
    expect(hostBlock).not.toContain("wrote to stderr")
  })
})

describe("renderHostBlock for a step that failed before it could compare again", () => {
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
    const lines = renderRecord(hostRecord, "apply", 1)?.split("\n").slice(3)

    expect(lines).toStrictEqual(["        values before the fix", "        got:  old", "        want: new"])
  })

  it("should show no details when the last compare was in sync, because a caught failure failed the step", async () => {
    const marker = path.join(await makeTempDir(), "marker")
    const hostBlock = await formatBlock(async (h) => {
      await h.ensure("Make it", {
        want: true,
        check: `test -f '${marker}'`,
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
      await h.ensure("Make it", { want: true, check: "false", fix: "echo one >&2; echo >&2; echo two >&2; exit 1" })
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

describe("renderHostBlock for a sudo that needed a password", () => {
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
      "  ! failed: (host fn)",
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

    expect(hostRecord.failure).toBeUndefined()
  })
})

describe("renderHostBlock and renderSummary for a warning", () => {
  it("should show a link to a missing path that's already right without --verbose, and count it", async () => {
    const { linkPath, target } = await createBrokenLink()
    const hostRecord = await runNamedHost(
      "a",
      async (h) => {
        await h.link(linkPath, target)
      },
      "plan",
    )

    expect([renderRecord(hostRecord, "plan"), renderRecordsSummary([hostRecord], "plan")]).toStrictEqual([
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

    expect(renderRecordsSummary([hostRecord], "plan").split("\n").at(-1)).toBe("a   1 change, 2 warnings")
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

/**
 * Runs a host in `apply`, then runs the same loaded host again in `mode`, and returns the second run's record. `fn`
 * gets whether it's the first apply, so it can fail there and leave its changes open.
 */
const runAfterApply = async (fn: (h: Host, isFirstApply: boolean) => Promise<void>, mode: Mode) => {
  let isFirstApply = true
  const loadedHost = loadHostDefinition(host({ name: "a", target: "@local" }, async (h) => fn(h, isFirstApply)))

  await prepareAndRunHost(loadedHost, "apply")
  isFirstApply = false
  return prepareAndRunHost(loadedHost, mode)
}

/** Returns an `ensure` that makes a marker file, so it changes the first time it runs on a host. */
const createMarker = async (): Promise<EnsureOptions<boolean>> => {
  const markerPath = path.join(await makeTempDir(), "made")
  return { want: true, check: `test -f '${markerPath}'`, fix: `touch '${markerPath}'` }
}

/** Runs a host whose first apply changes `Make marker` and fails before the run after it, then runs it again in `mode`. */
const resumeAfterFailedApply = async (mode: Mode, restartCommand = "true") => {
  const marker = await createMarker()
  return runAfterApply(async (h, isFirstApply) => {
    const madeMarker = await h.ensure("Make marker", marker)
    if (isFirstApply) throwBoom()
    await h.run("Restart", restartCommand, { after: [madeMarker] })
  }, mode)
}

/** Runs a host whose first apply changes `Make marker` and runs the run after it, then fails, then runs it in `mode`. */
const resumeAfterRunCompleted = async (mode: Mode) => {
  const marker = await createMarker()
  return runAfterApply(async (h, isFirstApply) => {
    const madeMarker = await h.ensure("Make marker", marker)
    await h.run("Restart", "true", { after: [madeMarker] })
    if (isFirstApply) throwBoom()
  }, mode)
}

describe("renderHostBlock for a step still open from an earlier apply", () => {
  it.each(["apply", "plan"] as const)(
    "should show it as resume, and the run it triggers, at level 0 in %s",
    async (mode) => {
      expect(renderRecord(await resumeAfterFailedApply(mode), mode)).toBe(
        [
          "a",
          "  ^ resume: (ensure) Make marker   an earlier apply didn't finish, so its follow-ups that didn't complete still trigger",
          "  > triggered: (run) Restart   triggered because it didn't complete in an earlier unfinished apply",
        ].join("\n"),
      )
    },
  )

  it("should leave the note off a run it triggers that fails, which shows its error", async () => {
    expect(renderRecord(await resumeAfterFailedApply("apply", "exit 1"), "apply")).toBe(
      [
        "a",
        "  ^ resume: (ensure) Make marker   an earlier apply didn't finish, so its follow-ups that didn't complete still trigger",
        "  ! failed: (run) Restart",
        "      failed to run the step -> exited with code 1",
      ].join("\n"),
    )
  })

  it("should leave it out of the summary's count, which counts only the run", async () => {
    expect(renderRecordsSummary([await resumeAfterFailedApply("apply")], "apply")).toBe("a   1 change")
  })
})

describe("renderSummary", () => {
  it("should list each host's status, padded to the longest name, after the plan reminder", async () => {
    const hostRecords = [
      await runNamedHost("caddy", stayRight, "plan"),
      await runNamedHost("immich", failRead, "plan"),
      await runNamedHost("sonarr", changeAndRun, "plan"),
      await runNamedHost("web", changeOnce, "plan"),
    ]

    expect(renderRecordsSummary(hostRecords, "plan")).toBe(
      [
        "Steps after a change were checked without that change, so apply may differ.",
        "",
        "caddy    unchanged",
        "immich   failed",
        "sonarr   2 changes",
        "web      1 change",
      ].join("\n"),
    )
  })

  it("should count waiting steps apart from changes", async () => {
    const hostRecords = [await runNamedHost("macbook", waitOnBrew, "plan")]

    expect(renderRecordsSummary(hostRecords, "plan").split("\n").at(-1)).toBe("macbook   1 change, 1 waiting")
  })

  it("should leave out the reminder, and count nothing, when only an always run would run", async () => {
    const hostRecords = [await runNamedHost("a", runOnce, "plan")]

    expect(renderRecordsSummary(hostRecords, "plan")).toBe("a   unchanged")
  })

  it("should count an always run in plan with -v, where its line shows", async () => {
    const hostRecords = [await runNamedHost("a", runOnce, "plan")]

    expect(renderRecordsSummary(hostRecords, "plan", 1)).toBe("a   1 change")
  })

  it("should show the reminder when only an open change triggered a run", async () => {
    expect(renderRecordsSummary([await resumeAfterFailedApply("plan")], "plan")).toBe(
      ["Steps after a change were checked without that change, so apply may differ.", "", "a   1 change"].join("\n"),
    )
  })

  it("should leave out the reminder in apply", async () => {
    const hostRecords = [await runNamedHost("a", runOnce, "apply")]

    expect(renderRecordsSummary(hostRecords, "apply")).toBe("a   1 change")
  })
})

/** Plans a host with `fn` and returns its block, as the CLI builds it. */
const planBlock = async (fn: HostFunction, name = "a") => toHostBlock(await runNamedHost(name, fn, "plan"), "plan")

describe("hasDrift", () => {
  it("should be true when a step's check did not pass", async () => {
    expect(hasDrift(await planBlock(changeOnce))).toBe(true)
  })

  it("should be false when only a run happened", async () => {
    expect(hasDrift(await planBlock(runOnce))).toBe(false)
  })

  it("should be false when the only step failed", async () => {
    expect(hasDrift(await planBlock(failRead))).toBe(false)
  })

  it("should be true when only an open change triggered a run", async () => {
    const hostBlock = toHostBlock(await resumeAfterFailedApply("plan"), "plan")

    expect(hasDrift(hostBlock)).toBe(true)
  })

  it("should be false for a resume step whose run already completed", async () => {
    const hostBlock = toHostBlock(await resumeAfterRunCompleted("plan"), "plan")

    expect(hasDrift(hostBlock)).toBe(false)
  })
})

// Match a status line for a change or a triggered run, like `  ~ change: (ensure) Pending`.
const CHANGE_STATUS_LINE = /^ {2}[>~] /mv

describe("getExitCode", () => {
  it("should be 0 from plan when the only change is a run", async () => {
    expect(getExitCode([await planBlock(runOnce)], "plan")).toBe(0)
  })

  it("should be 2 from plan when a host has drift", async () => {
    expect(getExitCode([await planBlock(changeOnce)], "plan")).toBe(2)
  })

  it("should be 2 from plan when only an open change triggered a run", async () => {
    const hostBlock = toHostBlock(await resumeAfterFailedApply("plan"), "plan")

    expect(getExitCode([hostBlock], "plan")).toBe(2)
  })

  it("should be 0 from apply when a host has drift", async () => {
    expect(getExitCode([await planBlock(changeOnce)], "apply")).toBe(0)
  })

  it("should be 0 from plan when the only finding is a warning", async () => {
    const { linkPath, target } = await createBrokenLink()
    const hostBlock = await planBlock(async (h) => {
      await h.link(linkPath, target)
    })

    expect(getExitCode([hostBlock], "plan")).toBe(0)
  })

  it("should be 1 when a host fails, even with drift on another", async () => {
    const hostBlocks = [await planBlock(changeOnce, "a"), await planBlock(failRead, "b")]

    expect(getExitCode(hostBlocks, "plan")).toBe(1)
  })

  // Cover each status `hasDrift` counts, so a drift entry can't be hidden at the default level.
  it.each([
    { description: "a step that would change", runHostRecord: async () => runNamedHost("a", changeOnce, "plan") },
    { description: "a run only an open change triggered", runHostRecord: async () => resumeAfterFailedApply("plan") },
  ])("should show a line and the reminder when plan exits 2 for $description", async ({ runHostRecord }) => {
    const hostBlock = toHostBlock(await runHostRecord(), "plan")
    const shownHostBlock = toShownHostBlock(hostBlock, 0)

    expect(getExitCode([hostBlock], "plan")).toBe(2)
    expect(renderHostBlock(shownHostBlock, { verbosity: 0 })).toMatch(CHANGE_STATUS_LINE)
    expect(renderSummary([shownHostBlock], "plan")).toStartWith(
      "Steps after a change were checked without that change, so apply may differ.",
    )
  })
})

/**
 * Returns a temp directory with `old.conf` holding `a`, and the path of `new.conf`, which doesn't exist yet. The names
 * are the same length, so the paths line up.
 */
const createSudoPaths = async () => {
  const directory = await makeTempDir()
  const oldPath = path.join(directory, "old.conf")
  await bun.write(oldPath, "a\n")
  return { directory, oldPath, newPath: path.join(directory, "new.conf") }
}

describe("renderHostBlock for what a command printed", () => {
  it("should show each command's exit code under it with -vvv", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.run(
      "Check it",
      async ({ exec, inspect }) => {
        await exec("true")
        await inspect("exit 3")
      },
      { after: "always" },
    )

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n")).toStrictEqual([
      "a",
      "  > always: (run) Check it",
      "      commands:",
      "        (exec)    $ true",
      "                      output:",
      "                        exit: 0",
      "        (inspect) $ exit 3",
      "                      output:",
      "                        exit: 3",
    ])
  })

  it("should show stdout and stderr after the exit code, lined up, with later lines under the first", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.run("Print it", String.raw`printf '  one\ntwo  \n\n'; echo oops >&2`, { after: "always" })

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n").slice(4)).toStrictEqual([
      "            output:",
      "              exit:   0",
      "              stdout:   one",
      "                      two",
      "              stderr: oops",
    ])
  })

  it("should show every line of a long stdout", async () => {
    const hostSession = await createSession()
    await hostSession.host.read("seq 25")

    const lines = renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n")
    expect([lines?.length, lines?.at(-1)]).toStrictEqual([29, "                25"])
  })

  it("should show a secret in a command's output as [MASKED]", async () => {
    const hostSession = await createSession()
    await hostSession.host.read('printf %s "$TOKEN"', { secretEnv: { TOKEN: "s3cret-value" } })

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n").slice(-3)).toStrictEqual([
      "      output:",
      "        exit:   0",
      "        stdout: [MASKED]",
    ])
  })

  it("should group a step's commands under a heading for each phase with -vvv", async () => {
    const filePath = path.join(await makeTempDir(), "hostname")
    const hostSession = await createSession("apply")
    await hostSession.host.ensure("Set the hostname", {
      want: "web1",
      check: `cat '${filePath}' 2>/dev/null || true`,
      fix: `printf web1 > '${filePath}'`,
    })

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n").slice(4)).toStrictEqual([
      "      commands:",
      "        before:",
      `          $ cat '${filePath}' 2>/dev/null || true`,
      "              output:",
      "                exit: 0",
      "        fix:",
      `          $ printf web1 > '${filePath}'`,
      "              output:",
      "                exit: 0",
      "        after:",
      `          $ cat '${filePath}' 2>/dev/null || true`,
      "              output:",
      "                exit:   0",
      "                stdout: web1",
    ])
  })

  it("should show only the phases that ran", async () => {
    const hostSession = await createSession("apply")
    await attempt(async () => hostSession.host.ensure("Set it", { want: true, check: "false", fix: "exit 1" }))

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n").slice(-9)).toStrictEqual([
      "        commands:",
      "          before:",
      "            $ false",
      "                output:",
      "                  exit: 1",
      "          fix:",
      "            $ exit 1",
      "                output:",
      "                  exit: 1",
    ])
  })

  it("should leave the phases out with -vv", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.ensure("Check it", { want: true, check: "true", fix: "true" })

    expect(renderRecord(hostSession.hostRecord, "apply", 2)?.split("\n").slice(2)).toStrictEqual([
      "      commands:",
      "        $ true",
    ])
  })

  it("should start a multi-line command's later lines with a continuation prompt, inside a phase", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.ensure("Check it", { want: true, check: "echo hi\ntrue", fix: "true" })

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n").slice(2, 7)).toStrictEqual([
      "      commands:",
      "        before:",
      "          $ echo hi",
      "          > true",
      "              output:",
    ])
  })

  it("should leave the exit codes out with -vv", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.run("Check it", "true", { after: "always" })

    expect(renderRecord(hostSession.hostRecord, "apply", 2)?.split("\n").slice(2)).toStrictEqual([
      "      commands:",
      "        $ true",
    ])
  })

  it("should show a read's exit code right under its line, after its options", async () => {
    const hostSession = await createSession()
    await hostSession.host.read("true")
    await hostSession.host.read("true", { env: { A: "1" } })

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n")).toStrictEqual([
      "a",
      "  · observed: (read) true",
      "      output:",
      "        exit: 0",
      "  · observed: (read) true",
      "      options:",
      "        env:",
      "          A: 1",
      "      output:",
      "        exit: 0",
    ])
  })

  it("should show a command's error in place of its exit code when it couldn't run", async () => {
    // Stand in for a transport that can't reach the host, so no command runs at all.
    // oxlint-disable-next-line typescript/require-await - a transport returns a promise, and this one fails without awaiting
    const hostSession = await createWrappedSession("apply", () => async () => err("the connection dropped", undefined))
    await attempt(async () => hostSession.host.run("Check it", "true", { after: "always" }))

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n").slice(3)).toStrictEqual([
      "        commands:",
      "          $ true",
      "              output:",
      "                error: the connection dropped",
    ])
  })
})

describe("renderHostBlock for a step's commands", () => {
  it("should list a step's commands under a commands heading with -vv, after its other details", async () => {
    const filePath = path.join(await makeTempDir(), "hostname")
    const hostSession = await createSession("apply")
    await hostSession.host.ensure("Set the hostname", {
      want: "web1",
      check: `cat '${filePath}' 2>/dev/null || true`,
      fix: `printf web1 > '${filePath}'`,
    })

    expect(renderRecord(hostSession.hostRecord, "apply", 2)?.split("\n")).toStrictEqual([
      "a",
      "  ~ change: (ensure) Set the hostname",
      "      got:  ''",
      "      want: web1",
      "      commands:",
      `        $ cat '${filePath}' 2>/dev/null || true`,
      `        $ printf web1 > '${filePath}'`,
      `        $ cat '${filePath}' 2>/dev/null || true`,
    ])
  })

  it("should leave the commands out with -v", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.run("Say hi", "echo hi", { after: "always" })

    expect(renderRecord(hostSession.hostRecord, "apply", 1)?.split("\n")).toStrictEqual([
      "a",
      "  > always: (run) Say hi",
    ])
  })

  it("should list no commands for a read, because its name is its command", async () => {
    const hostSession = await createSession()
    await hostSession.host.read("true")

    expect(renderRecord(hostSession.hostRecord, "apply", 2)?.split("\n")).toStrictEqual([
      "a",
      "  · observed: (read) true",
    ])
  })

  it("should show a command tsinfra wrote by its label, in angle brackets", async () => {
    const newPath = path.join(await makeTempDir(), "new.conf")
    const hostSession = await createSession("plan")
    await hostSession.host.file(newPath, "a\n")

    expect(renderRecord(hostSession.hostRecord, "plan", 2)?.split("\n").slice(2)).toStrictEqual([
      "      content: new file, 2 bytes",
      "      commands:",
      "        $ <file details script>",
    ])
  })

  it("should start a multi-line command's later lines with a continuation prompt", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.run("Say hi twice", "echo hi\necho hi", { after: "always" })

    expect(renderRecord(hostSession.hostRecord, "apply", 2)?.split("\n").slice(2)).toStrictEqual([
      "      commands:",
      "        $ echo hi",
      "        > echo hi",
    ])
  })

  it("should list a failed step's commands under its error, after what it found and before its hint", async () => {
    const hostSession = await createSession("apply")
    await attempt(async () =>
      hostSession.host.ensure("Set it", { want: true, check: "false", fix: NEEDS_PASSWORD_CMD }),
    )

    expect(renderRecord(hostSession.hostRecord, "apply", 2)?.split("\n").slice(3)).toStrictEqual([
      "        values before the fix",
      "        got:  exit code 1",
      "        want: exit code 0",
      "        commands:",
      "          $ false",
      `          $ ${NEEDS_PASSWORD_CMD}`,
      SUDO_OPTION_HINT,
    ])
  })

  it("should show a secret in a command's text as [MASKED]", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.run("Check the token", 'test "$TOKEN" = s3cret-value', {
      after: "always",
      secretEnv: { TOKEN: "s3cret-value" },
    })

    expect(renderRecord(hostSession.hostRecord, "apply", 2)?.split("\n").slice(-2)).toStrictEqual([
      "      commands:",
      '        $ test "$TOKEN" = [MASKED]',
    ])
  })
})

const setHostnameWithExec = async () => {
  const filePath = path.join(await makeTempDir(), "hostname")
  const hostSession = await createSession("apply")
  await hostSession.host.ensure("Set the hostname", {
    want: "web1",
    check: `cat '${filePath}' 2>/dev/null || true`,
    fix: async ({ exec }) => {
      await exec(`printf web1 > '${filePath}'`)
    },
  })
  return { filePath, hostRecord: hostSession.hostRecord }
}

describe("renderHostBlock for a tool call's tool", () => {
  it("should start a tool call's command with its tool, padded so the prompts line up", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.run(
      "Check it",
      async ({ exec, inspect }) => {
        await exec("true")
        await inspect("true")
      },
      { after: "always" },
    )

    expect(renderRecord(hostSession.hostRecord, "apply", 2)?.split("\n")).toStrictEqual([
      "a",
      "  > always: (run) Check it",
      "      commands:",
      "        (exec)    $ true",
      "        (inspect) $ true",
    ])
  })

  it("should line up a command with no tool past the column", async () => {
    const { filePath, hostRecord } = await setHostnameWithExec()

    expect(renderRecord(hostRecord, "apply", 2)?.split("\n").slice(4)).toStrictEqual([
      "      commands:",
      `               $ cat '${filePath}' 2>/dev/null || true`,
      `        (exec) $ printf web1 > '${filePath}'`,
      `               $ cat '${filePath}' 2>/dev/null || true`,
    ])
  })

  it("should line up the tool column across a step's phases with -vvv", async () => {
    const { filePath, hostRecord } = await setHostnameWithExec()

    expect(renderRecord(hostRecord, "apply", 3)?.split("\n").slice(4)).toStrictEqual([
      "      commands:",
      "        before:",
      `                 $ cat '${filePath}' 2>/dev/null || true`,
      "                     output:",
      "                       exit: 0",
      "        fix:",
      `          (exec) $ printf web1 > '${filePath}'`,
      "                     output:",
      "                       exit: 0",
      "        after:",
      `                 $ cat '${filePath}' 2>/dev/null || true`,
      "                     output:",
      "                       exit:   0",
      "                       stdout: web1",
    ])
  })

  it("should start a tool call's later command lines with a continuation prompt past its tool", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.run(
      "Say hi",
      async ({ exec }) => {
        await exec("echo hi\ntrue")
      },
      { after: "always" },
    )

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n").slice(2)).toStrictEqual([
      "      commands:",
      "        (exec) $ echo hi",
      "               > true",
      "                   output:",
      "                     exit:   0",
      "                     stdout: hi",
    ])
  })
})

const runCatWithInput = async () => {
  const hostSession = await createSession("apply")
  await hostSession.host.run(
    "Check it",
    async ({ exec }) => {
      await exec("cat >/dev/null", { input: "x", maskOutput: true })
    },
    { after: "always" },
  )
  return hostSession.hostRecord
}

describe("renderHostBlock for a tool call's options", () => {
  it("should name a tool call's options under its command with -vv", async () => {
    const hostRecord = await runCatWithInput()

    expect(renderRecord(hostRecord, "apply", 2)?.split("\n")).toStrictEqual([
      "a",
      "  > always: (run) Check it",
      "      commands:",
      "        (exec) $ cat >/dev/null",
      "                   options: input, maskOutput",
    ])
  })

  it("should show a tool call's options as a block before its output with -vvv", async () => {
    const hostRecord = await runCatWithInput()

    expect(renderRecord(hostRecord, "apply", 3)?.split("\n").slice(2)).toStrictEqual([
      "      commands:",
      "        (exec) $ cat >/dev/null",
      "                   options:",
      "                     input:      <content>",
      "                     maskOutput: true",
      "                   output:",
      "                     exit: 0",
    ])
  })

  it("should show a tool call's options inside its phase, at its output's indent", async () => {
    const filePath = path.join(await makeTempDir(), "hostname")
    const hostSession = await createSession("apply")
    await hostSession.host.ensure("Set the hostname", {
      want: "web1",
      check: `cat '${filePath}' 2>/dev/null || true`,
      fix: async ({ exec }) => {
        await exec(`cat > '${filePath}'`, { input: "web1" })
      },
    })

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n").slice(9, 15)).toStrictEqual([
      "        fix:",
      `          (exec) $ cat > '${filePath}'`,
      "                     options:",
      "                       input: <content>",
      "                     output:",
      "                       exit: 0",
    ])
  })

  it("should name a tool call's variables with -vv, and show their values, each secret masked, with -vvv", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.run(
      "Check it",
      async ({ exec }) => {
        await exec('test -n "$URL$TOKEN"', { env: { URL: "u" }, secretEnv: { TOKEN: "t0ken" } })
      },
      { after: "always" },
    )

    expect(
      ([2, 3] as const).map((verbosity) =>
        renderRecord(hostSession.hostRecord, "apply", verbosity)?.split("\n").slice(3),
      ),
    ).toStrictEqual([
      ['        (exec) $ test -n "$URL$TOKEN"', "                   options: env { URL }, secretEnv { TOKEN }"],
      [
        '        (exec) $ test -n "$URL$TOKEN"',
        "                   options:",
        "                     env:",
        "                       URL: u",
        "                     secretEnv:",
        "                       TOKEN: [MASKED]",
        "                   output:",
        "                     exit: 0",
      ],
    ])
  })

  it("should show no options for a tool call given only defaults", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.run(
      "Check it",
      async ({ exec }) => {
        await exec("true", { maskOutput: false })
      },
      { after: "always" },
    )

    expect(renderRecord(hostSession.hostRecord, "apply", 2)?.split("\n").slice(2)).toStrictEqual([
      "      commands:",
      "        (exec) $ true",
    ])
  })
})

describe("renderHostBlock for a step's options", () => {
  it("should show sudo on an options line under the step with -vv", async () => {
    const { oldPath, newPath } = await createSudoPaths()
    const { hostSession } = await createFakeSudoSession("plan")
    await hostSession.host.file(oldPath, "a\n", { sudo: true })
    await hostSession.host.file(newPath, "a\n", { sudo: true })
    await hostSession.host.ensure("Install git", { want: true, check: "true", fix: "true" })

    expect(renderRecord(hostSession.hostRecord, "plan", 2)?.split("\n")).toStrictEqual([
      "a",
      `  = unchanged: (file) ${oldPath}`,
      "      options: sudo",
      "      commands:",
      "        $ <file details script>",
      `  ~ change: (file) ${newPath}`,
      "      options: sudo",
      "      content: new file, 2 bytes",
      "      commands:",
      "        $ <file details script>",
      "  = unchanged: (ensure) Install git",
      "      commands:",
      "        $ true",
    ])
  })

  it("should leave the options out below -vv", async () => {
    const { newPath } = await createSudoPaths()
    const { hostSession } = await createFakeSudoSession("plan")
    await hostSession.host.file(newPath, "a\n", { sudo: true })

    expect(renderRecord(hostSession.hostRecord, "plan", 1)?.split("\n")).toStrictEqual([
      "a",
      `  ~ change: (file) ${newPath}`,
      "      content: new file, 2 bytes",
    ])
  })

  it("should show a waiting step's options under it", async () => {
    const { newPath } = await createSudoPaths()
    const { hostSession } = await createFakeSudoSession("plan")
    const brew = await hostSession.host.ensure("Install brew packages", { want: true, check: "false", fix: "true" })
    await hostSession.host.file(newPath, "a\n", { needs: [brew], sudo: true })
    await hostSession.host.ensure("Install fish", { needs: [brew], want: true, check: "true", fix: "true" })

    expect(renderRecord(hostSession.hostRecord, "plan", 2)?.split("\n")).toStrictEqual([
      "a",
      "  ~ change: (ensure) Install brew packages",
      "      commands:",
      "        $ false",
      `  ? waiting: (file) ${newPath}   needs 'Install brew packages'`,
      "      options: sudo",
      "  ? waiting: (ensure) Install fish   needs 'Install brew packages'",
    ])
  })

  // Skip this as root, because root can write to any directory, so the write wouldn't fail.
  it.skipIf(isRoot)("should show a failed step's options after its error", async () => {
    const { directory, newPath } = await createSudoPaths()
    await chmod(directory, 0o500)
    const { hostSession } = await createFakeSudoSession("apply")

    try {
      await attempt(async () => hostSession.host.file(newPath, "a\n", { sudo: true }))
      const lines = renderRecord(hostSession.hostRecord, "plan", 2)?.split("\n")
      expect([lines?.[1], lines?.[3]]).toStrictEqual([`  ! failed: (file) ${newPath}`, "        options: sudo"])
    } finally {
      await chmod(directory, 0o755)
    }
  })

  it("should name the variables in env and secretEnv without their values", async () => {
    const hostSession = await createSession()
    await hostSession.host.read("true", { env: { URL: "u", PORT: "1" }, secretEnv: { TOKEN: "t" } })

    expect(renderRecord(hostSession.hostRecord, "apply", 2)?.split("\n")).toStrictEqual([
      "a",
      "  · observed: (read) true",
      "      options: env { URL, PORT }, secretEnv { TOKEN }",
    ])
  })

  it("should name input on read and inspect with -vv", async () => {
    const hostSession = await createSession()
    await hostSession.host.read("cat >/dev/null", { input: "secret input" })
    await hostSession.host.inspect("cat >/dev/null", { input: "secret input" })

    expect(renderRecord(hostSession.hostRecord, "apply", 2)?.split("\n")).toStrictEqual([
      "a",
      "  · observed: (read) cat >/dev/null",
      "      options: input",
      "  · observed: (inspect) cat >/dev/null",
      "      options: input",
    ])
  })

  it("should show input as a stand-in on read and inspect with -vvv, never the input itself", async () => {
    const hostSession = await createSession()
    await hostSession.host.read("cat >/dev/null", { input: "secret input" })
    await hostSession.host.inspect("cat >/dev/null", { input: "secret input" })

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n")).toStrictEqual([
      "a",
      "  · observed: (read) cat >/dev/null",
      "      options:",
      "        input: <content>",
      "      output:",
      "        exit: 0",
      "  · observed: (inspect) cat >/dev/null",
      "      options:",
      "        input: <content>",
      "      output:",
      "        exit: 0",
    ])
  })

  it("should show input under the error when it's over the limit", async () => {
    const hostSession = await createSession()
    await attempt(async () => hostSession.host.read("cat", { input: "a".repeat(CONTENT_LIMIT_BYTES + 1) }))

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n").slice(1)).toStrictEqual([
      "  ! failed: (read) cat",
      "      failed to read 'cat' -> the input is 10 MB, above the 10 MB limit",
      "        options:",
      "          input: <content>",
    ])
  })

  it("should show sudo's value in an options block with -vvv, in place of the line", async () => {
    const { newPath } = await createSudoPaths()
    const { hostSession } = await createFakeSudoSession("plan")
    await hostSession.host.file(newPath, "a\n", { sudo: true })

    expect(renderRecord(hostSession.hostRecord, "plan", 3)?.split("\n").slice(0, 6)).toStrictEqual([
      "a",
      `  ~ change: (file) ${newPath}`,
      "      options:",
      "        sudo: true",
      "      content: new file, 2 bytes",
      "      commands:",
    ])
  })

  it("should show each variable's value, lined up within its object, and mask each secret", async () => {
    const hostSession = await createSession()
    const options = { env: { URL: "u", PORT: "1" }, secretEnv: { LONG_TOKEN: "t" } }
    await hostSession.host.read("true", options)

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n")).toStrictEqual([
      "a",
      "  · observed: (read) true",
      "      options:",
      "        env:",
      "          URL:  u",
      "          PORT: 1",
      "        secretEnv:",
      "          LONG_TOKEN: [MASKED]",
      "      output:",
      "        exit: 0",
    ])
  })

  it("should line up a multi-line value's later lines under its first", async () => {
    const hostSession = await createSession()
    await hostSession.host.read("true", { env: { KEY: "first\nsecond" } })

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n").slice(2, 6)).toStrictEqual([
      "      options:",
      "        env:",
      "          KEY: first",
      "               second",
    ])
  })

  it("should show an empty value as a marker, and quote one with whitespace at either end", async () => {
    const hostSession = await createSession()
    await hostSession.host.read("true", { env: { EMPTY: "", PADDED: " a", PLAIN: "a" } })

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n").slice(2, 7)).toStrictEqual([
      "      options:",
      "        env:",
      "          EMPTY:  ''",
      "          PADDED: ' a'",
      "          PLAIN:  a",
    ])
  })

  // Skip this as root, because root can write to any directory, so the write wouldn't fail.
  it.skipIf(isRoot)("should show a failed step's options block after its error with -vvv", async () => {
    const { directory, newPath } = await createSudoPaths()
    await chmod(directory, 0o500)
    const { hostSession } = await createFakeSudoSession("apply")

    try {
      await attempt(async () => hostSession.host.file(newPath, "a\n", { sudo: true }))
      const lines = renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n")
      expect(lines?.slice(3, 5)).toStrictEqual(["        options:", "          sudo: true"])
    } finally {
      await chmod(directory, 0o755)
    }
  })

  it("should name a step's own options with -vv, and show their values with -vvv, in plan too", async () => {
    const { newPath } = await createSudoPaths()
    const hostSession = await createSession("plan")
    await hostSession.host.file(newPath, "a\n", { validate: (tmp) => `test -s ${tmp}`, secret: true, overwrite: false })

    expect(renderRecord(hostSession.hostRecord, "plan", 2)?.split("\n").slice(2, 3)).toStrictEqual([
      "      options: validate, secret, overwrite",
    ])
    expect(renderRecord(hostSession.hostRecord, "plan", 3)?.split("\n").slice(2, 6)).toStrictEqual([
      "      options:",
      `        validate:  test -s "$tmppath"`,
      "        secret:    true",
      "        overwrite: false",
    ])
  })

  it("should show the shell options before a step's own", async () => {
    const { newPath } = await createSudoPaths()
    const { hostSession } = await createFakeSudoSession("plan")
    await hostSession.host.file(newPath, "a\n", { sudo: true, overwrite: false })

    expect(renderRecord(hostSession.hostRecord, "plan", 2)?.split("\n")[2]).toBe("      options: sudo, overwrite")
  })

  it("should show link's force and ensure's verify when they're set", async () => {
    const directory = await makeTempDir()
    const linkPath = path.join(directory, "link")
    const hostSession = await createSession("plan")
    await hostSession.host.link(linkPath, directory, { force: true })
    await hostSession.host.ensure("Reboot", { want: true, check: "true", fix: "true", verify: false })

    const lines = renderRecord(hostSession.hostRecord, "plan", 3)?.split("\n")
    const linkLines = lines?.slice(1, 5)
    const ensureStart = lines?.indexOf("  = unchanged: (ensure) Reboot")
    const ensureLines = lines?.slice(ensureStart).slice(0, 3)

    expect([linkLines, ensureLines]).toStrictEqual([
      [
        `  ~ change: (link) ${linkPath}`,
        "      options:",
        "        force: true",
        `      target: new link to ${directory}`,
      ],
      ["  = unchanged: (ensure) Reboot", "      options:", "        verify: false"],
    ])
  })

  it("should show a failed validate's command in the options under the error", async () => {
    const { newPath } = await createSudoPaths()
    const hostSession = await createSession("apply")
    await attempt(async () => hostSession.host.file(newPath, "a\n", { validate: (tmp) => `false ${tmp}` }))

    expect(renderRecord(hostSession.hostRecord, "apply", 3)?.split("\n").slice(3, 5)).toStrictEqual([
      "        options:",
      `          validate: false "$tmppath"`,
    ])
  })

  it("should leave out options the step didn't set", async () => {
    const { newPath } = await createSudoPaths()
    const hostSession = await createSession("plan")
    await hostSession.host.read("true", { env: {}, secretEnv: {} })
    await hostSession.host.file(newPath, "a\n", { sudo: false })

    expect(renderRecord(hostSession.hostRecord, "plan", 3)).not.toContain("options")
  })
})
