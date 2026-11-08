import { chmod, mkdtemp, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"

// Prints the report for one example host per way a block can look, to inspect the output by eye.
// It runs `plan` for what only shows in `plan` or without `--verbose`, then `apply --verbose` for the rest.
// Run it with `bask report-preview`, and with `NO_COLOR=1` to see it without colors.
import bun from "bun"
import pc from "picocolors"
import { err } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { HostFunction } from "#hosts/host.ts"
import type { HostReport } from "#hosts/run.ts"
import { hasDrift, prepareHosts, runHost } from "#hosts/run.ts"
import { printTsinfraError } from "#report/errors.ts"
import { formatHostBlock } from "#report/format.ts"
import { formatSummary } from "#report/format/summary.ts"
import { PUBLIC_FILE_MODE } from "#session/handlers/shared/filesystem/mode.ts"

/** One run of the preview: `plan` shows what only it and a run without `--verbose` show, and `applyVerbose` the rest. */
type PreviewPass = "plan" | "applyVerbose"

interface Scenario {
  name: string
  target: string
  /** The pass the case shows up in. Defaults to `applyVerbose`, which shows the most. */
  pass?: PreviewPass
  fn: HostFunction
}

const CONFIG_LINES = Array.from({ length: 12 }, (_, index) => `setting_${index + 1} = default`)

// Write each line through `printf`, so the check prints exactly these lines.
const printLines = (lines: string[]) => `printf '%s\\n' ${lines.map((line) => `'${line}'`).join(" ")}`

// A 40-line config, and the version the script wants, with changes spread out so the diff shows several hunks.
// Lines 3 and 4 change together, line 15 gains two lines after it, line 28 goes away, and line 38 changes.
const optionLine = (number: number, value: string) => `option_${String(number).padStart(2, "0")} = ${value}`
const SITE_CONFIG = Array.from({ length: 40 }, (_, index) => optionLine(index + 1, index % 3 === 0 ? "on" : "off"))
const WANTED_SITE_CONFIG = SITE_CONFIG.flatMap((line, index) => {
  const number = index + 1
  if (number === 3 || number === 4 || number === 38) return [optionLine(number, "tuned")]
  if (number === 15) return [line, "option_15b = on", "option_15c = on"]
  if (number === 28) return []
  return [line]
})

// Pick a group the user is in besides their own, so a `group:` row can change in `apply` without root.
const OTHER_GROUP_ID = process.getgroups?.().find((gid) => gid !== os.userInfo().gid) ?? os.userInfo().gid

const BIG_VALUE_LINE_COUNT = 2000
const numberedLines = (prefix: string) =>
  Array.from({ length: BIG_VALUE_LINE_COUNT }, (_, index) => `${prefix} ${index}`).join("\n")

/**
 * Returns one example host for each way a block can look, with markers in `dir` so `apply` can make and see real
 * changes. Cases that only differ in their words share one example, and each failure needs a host of its own, because a
 * host stops at its first failure.
 */
const createScenarios = (dir: string): Scenario[] => {
  const marker = (file: string) => path.join(dir, file)
  const touchStep = (file: string) => ({
    check: `test -f '${marker(file)}'`,
    want: true,
    fix: `touch '${marker(file)}'`,
  })

  return [
    {
      // `?` lines with notes in one column, a note that names two steps, a waiting count, and the plan reminder.
      name: "waiting",
      target: "@local",
      pass: "plan",
      fn: async (h) => {
        const brew = await h.ensure("Install brew packages", touchStep("brew"))
        const fish = await h.ensure("Install fish", { needs: [brew], ...touchStep("fish") })
        await h.ensure("Install editor plugins", { needs: [brew, fish], ...touchStep("editor") })
      },
    },
    {
      // A diff too long to show, which becomes a note without `--verbose`.
      name: "long-diff",
      target: "@local",
      pass: "plan",
      fn: async (h) => {
        await h.ensure("Write the site config", {
          check: `cat '${marker("site")}' 2>/dev/null || ${printLines(SITE_CONFIG)}`,
          want: WANTED_SITE_CONFIG.join("\n"),
          fix: `${printLines(WANTED_SITE_CONFIG)} > '${marker("site")}'`,
        })
      },
    },
    {
      // The note that replaces a diff that takes too long, which suggests `--verbose`.
      name: "big-diff",
      target: "@local",
      pass: "plan",
      fn: async (h) => {
        await h.ensure("Write the big file", {
          check: `cat '${marker("big")}' 2>/dev/null || seq -f 'old %g' 0 ${BIG_VALUE_LINE_COUNT - 1}`,
          want: numberedLines("new"),
          fix: `seq -f 'new %g' 0 ${BIG_VALUE_LINE_COUNT - 1} > '${marker("big")}'`,
        })
      },
    },
    {
      // A warning on a step that was already right, which shows it without `--verbose`, and a warning count.
      name: "warning",
      target: "@local",
      pass: "plan",
      fn: async (h) => {
        await symlink(marker("missing-dotfile"), marker("broken-link"))
        await h.link(marker("broken-link"), marker("missing-dotfile"))
      },
    },
    {
      // No block, only an `unchanged` summary line, because nothing changed and there's no `--verbose`.
      name: "unchanged",
      target: "@local",
      pass: "plan",
      fn: async (h) => {
        await h.ensure("Install git", { check: "true", want: true, fix: "true" })
      },
    },
    {
      // Every kind of step that passes, with the kinds padded to one column.
      // An `ensure` with nothing under it, a quoted `got` and `want`, and a diff with a hunk for each change far apart.
      // A file with a diff and a `mode:` row, a new file's size, and a secret file's sizes lined up with a `group:` row.
      // A link that replaces a file, one whose target changed, and a new one to a missing path, with its warning.
      // `> triggered:` runs, `= unchanged:` for an `ensure` and an untriggered run, and `· observed:` for a read.
      name: "steps",
      target: "@local",
      fn: async (h) => {
        await bun.write(marker("app.conf"), "port = 8080\nworkers = 4\nlog = info\n")
        await chmod(marker("app.conf"), 0o600)
        await bun.write(marker("token"), "old-token\n")
        const dotfile = marker("dotfile")
        await bun.write(dotfile, "set -x EDITOR vim\n")
        await bun.write(marker("old-dotfile"), "set -x EDITOR nano\n")
        await bun.write(marker("real-file"), "a file where the link goes\n")
        await symlink(marker("old-dotfile"), marker("moved-link"))

        await h.ensure("Install Caddy", touchStep("caddy"))
        await h.ensure("Set the hostname", {
          check: `cat '${marker("hostname")}' 2>/dev/null || true`,
          want: "web1",
          fix: `printf web1 > '${marker("hostname")}'`,
        })
        const wantedConfig = CONFIG_LINES.map((line, index) =>
          index === 1 || index === 10 ? line.replace("default", "tuned") : line,
        )
        const config = await h.ensure("Write the config", {
          check: `cat '${marker("config")}' 2>/dev/null || ${printLines(CONFIG_LINES)}`,
          want: wantedConfig.join("\n"),
          fix: `${printLines(wantedConfig)} > '${marker("config")}'`,
        })

        await h.file(marker("app.conf"), "port = 8080\nworkers = 8\nlog = info\n", { mode: PUBLIC_FILE_MODE })
        await h.file(marker("new.conf"), "enabled = true\n")
        await h.file(marker("token"), "new-token\n", { secret: true, group: OTHER_GROUP_ID })

        await h.link(marker("real-file"), dotfile, { force: true })
        await h.link(marker("moved-link"), dotfile)
        await h.link(marker("broken-link"), marker("missing-dotfile"))

        await h.run("Reload the app", "true", { after: [config] })
        const caddyfile = await h.ensure("Write the Caddyfile", { check: "true", want: true, fix: "true" })
        await h.run("Restart caddy", "true", { after: [caddyfile] })
        await h.read("uname -m")
      },
    },
    {
      // A block with "no steps", which only shows with `--verbose`.
      name: "no-steps",
      target: "@local",
      fn: async () => {
        // A script with no steps.
      },
    },
    {
      // A quoted `got` and `want`, and the stderr of a fix that exits 0 and of the check after it, each with its command.
      name: "fix-and-check-stderr",
      target: "@local",
      fn: async (h) => {
        await h.ensure("Set the app's mode", {
          check: "echo staging; echo 'appctl: warning: config format is deprecated' >&2",
          want: "production",
          fix: "echo 'appctl: warning: config is read-only, ignoring the new value' >&2",
        })
      },
    },
    {
      // A multi-line string value as a diff, and a multi-line stderr lined up under its first line.
      name: "multi-line-value",
      target: "@local",
      fn: async (h) => {
        await h.ensure("Set the allowed hosts", {
          check: String.raw`printf 'sonarr.lan\nradarr.lan\n'; printf 'warning: radarr.lan is deprecated\nsee the docs\n' >&2`,
          want: "sonarr.lan\nprowlarr.lan",
          fix: "true",
        })
      },
    },
    {
      // A boolean, which is neither quoted nor italic, and a check function with one command, which shows its stderr.
      name: "one-command-check-function",
      target: "@local",
      fn: async (h) => {
        await h.ensure("App is healthy", {
          check: async ({ inspect }) => {
            const { exitCode } = await inspect("echo 'curl: (7) Failed to connect to localhost port 8080' >&2; exit 7")
            return exitCode === 0
          },
          want: true,
          fix: "true",
        })
      },
    },
    {
      // A note for each phase that ran several commands, one during the fix and one after it.
      name: "several-commands-in-both-phases",
      target: "@local",
      fn: async (h) => {
        await h.ensure("App is healthy", {
          check: async ({ inspect }) => {
            await inspect("echo 'ls: /opt/old: No such file or directory' >&2; exit 2")
            await inspect("true")
            return false
          },
          want: true,
          fix: async ({ exec }) => {
            await exec("echo 'appctl: warning: config is read-only' >&2")
            await exec("true")
          },
        })
      },
    },
    {
      // An exit code, which is italic because it isn't quoted, and a multi-line command, whose stderr follows the arrow
      // on its last line.
      name: "multi-line-command",
      target: "@local",
      fn: async (h) => {
        await h.ensure("Enable the app", {
          check: "echo 'checking the app'\necho 'the app is disabled' >&2\nexit 1",
          want: true,
          fix: "true",
        })
      },
    },
    {
      // A failed fix, with the values from before the fix under their note.
      name: "failed-fix",
      target: "@local",
      fn: async (h) => {
        await h.ensure("Set the timezone", {
          check: "echo America/New_York",
          want: "UTC",
          fix: "echo 'sudo: a password is required' >&2; exit 1",
        })
      },
    },
    {
      // An error with no details under it, which is how every failure without a comparison looks.
      name: "error",
      target: "@local",
      fn: async (h) => {
        await h.ensure("Enable the app", {
          check: () => {
            throw new Error("Unexpected token '}' in JSON at position 41")
          },
          want: true,
          fix: "true",
        })
      },
    },
    {
      // A host that couldn't be prepared, as `(host)` and its target in the value color, because its script never ran.
      name: "unreachable",
      target: "web.lan",
      fn: async (h) => {
        await h.read("true")
      },
    },
    {
      // A failure no step owns, as `(host)` and the host's script, after a step that changed.
      name: "script-error",
      target: "@local",
      fn: async (h) => {
        await h.ensure("Install Caddy", touchStep("throws"))
        throw new Error("the API token is missing")
      },
    },
  ]
}

const getExitCode = (hostReports: HostReport[], mode: Mode) => {
  if (hostReports.some(({ failure }) => failure)) return 1
  return mode === "plan" && hostReports.some((hostReport) => hasDrift(hostReport)) ? 2 : 0
}

const PASS_RUNS: Record<PreviewPass, { mode: Mode; verbose: boolean }> = {
  plan: { mode: "plan", verbose: false },
  applyVerbose: { mode: "apply", verbose: true },
}

/** Runs the scenarios of one pass and prints each block, the summary, and the exit code the CLI would return. */
const previewPass = async (pass: PreviewPass) => {
  const { mode, verbose } = PASS_RUNS[pass]
  const dir = await mkdtemp(path.join(os.tmpdir(), "tsinfra-preview-"))
  try {
    console.log(pc.cyan(pc.bold(`==== tsinfra ${mode}${verbose ? " --verbose" : ""} ====`)))
    console.log()

    const hostReports: HostReport[] = []
    const scenarios = createScenarios(dir).filter((scenario) => (scenario.pass ?? "applyVerbose") === pass)
    const hostEntries = await prepareHosts(
      scenarios.map((scenario) => Object.assign(scenario, { options: { sudo: false } })),
    )
    for (const hostEntry of hostEntries) {
      // oxlint-disable-next-line no-await-in-loop - hosts run one at a time, the same as the CLI
      const hostReport = await runHost(hostEntry, mode)
      hostReports.push(hostReport)

      const block = formatHostBlock(hostReport, { verbose })
      if (block) console.log(`${block}\n`)
    }

    console.log(formatSummary(hostReports, mode))

    console.log(pc.dim(`\nexit code ${getExitCode(hostReports, mode)}`))
    console.log()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Prints the kind of error tsinfra itself reports on stderr, outside any host's block. */
const previewOwnErrors = () => {
  console.log(pc.cyan(pc.bold("==== tsinfra's own errors (stderr) ====")))
  console.log()
  printTsinfraError(
    err("failed to load hosts:\nfailed to load host 'a' -> default must be an object (was missing)", undefined),
  )
  console.log()
}

const main = async (): Promise<number> => {
  await previewPass("plan")
  await previewPass("applyVerbose")
  previewOwnErrors()
  return 0
}

process.exitCode = await main()
