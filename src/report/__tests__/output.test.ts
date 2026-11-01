import { describe, expect, it } from "bun:test"

import { formatMessage } from "@optique/core/message"
import { attempt, err } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { HostFunction } from "#hosts/host.ts"
import { host } from "#hosts/host.ts"
import { runHost } from "#hosts/run.ts"
import { formatHostBlock, formatSummary, toErrorMessage } from "#report/output.ts"
import type { Host } from "#session/session.ts"

const runNamedHost = async (name: string, fn: HostFunction, mode: Mode) =>
  runHost({ name, ...host("@local", fn) }, mode)

const formatBlock = async (fn: HostFunction, mode: Mode) => formatHostBlock(await runNamedHost("a", fn, mode))

const changeAndRun = async (h: Host) => {
  await h.ensure("Write the unit", { check: "false", fix: "true" })
  await h.run("Reload systemd", "true", { when: true })
  await h.run("Prune", "true", { when: true })
}

const runOnce = async (h: Host) => {
  await h.run("Reload systemd", "true", { when: true })
}

const stayRight = async (h: Host) => {
  await h.ensure("Install Caddy", { check: "true", fix: "true" })
  await h.read("true")
  await h.run("Reload systemd", "true", { when: false })
}

const failVerify = async (h: Host) => {
  await h.ensure("Make it", { check: "echo missing >&2; false", fix: "true" })
}

const failRead = async (h: Host) => {
  await h.read("exit 1")
}

const changeThenThrow = async (h: Host) => {
  await h.ensure("Pending", { check: "false", fix: "true" })
  throw new Error("boom")
}

const runStepsAtOnce = async (h: Host) => {
  await Promise.allSettled([
    h.ensure("First", { check: "sleep 0.1", fix: "true" }),
    h.ensure("Second", { check: "true", fix: "true" }),
  ])
}

const nestStep = async (h: Host) => {
  await h.ensure("Outer", {
    check: "false",
    fix: async () => {
      await h.ensure("Inner", { check: "true", fix: "true" })
    },
  })
}

const catchFailedExec = async (h: Host) => {
  await h.ensure("Make marker", {
    check: "false",
    fix: async ({ exec }) => {
      await attempt(async () => exec("exit 1"))
    },
  })
}

const changeOnce = async (h: Host) => {
  await h.ensure("Pending", { check: "false", fix: "true" })
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

  it("should show a failed step's error on indented lines under it", async () => {
    expect(await formatBlock(failVerify, "apply")).toBe(
      [
        "a",
        "  ! Make it",
        "      the check for step 'Make it' still fails after the fix",
        "        exited with code 1: missing",
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

  it("should show the error from steps run at once under the step that was running", async () => {
    expect(await formatBlock(runStepsAtOnce, "plan")).toBe(
      "a\n  ! First\n      'ensure' can't run while step 'First' is running",
    )
  })

  it("should show a failure the script caught under the step it happened in", async () => {
    expect(await formatBlock(catchFailedExec, "apply")).toBe(
      "a\n  ! Make marker\n      failed to run 'exit 1' -> exited with code 1",
    )
  })

  it("should show a nested step's failure once, under the outer step", async () => {
    expect(await formatBlock(nestStep, "apply")).toBe(
      "a\n  ! Outer\n      failed to run the fix for step 'Outer' -> 'ensure' can't run while step 'Outer' is running",
    )
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
        "caddy    ok",
        "immich   failed",
        "sonarr   3 changes",
        "web      1 change",
      ].join("\n"),
    )
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

describe("toErrorMessage", () => {
  it("should keep each line of the error's message chain", () => {
    const error = err("failed to load hosts:\nfailed to load host 'a' -> boom", undefined)

    expect(formatMessage(toErrorMessage(error))).toBe("failed to load hosts:\nfailed to load host 'a' -> boom")
  })
})
