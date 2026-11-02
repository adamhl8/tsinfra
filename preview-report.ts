// Prints the report for one example host per way a block can look, to inspect the output by eye.
// It runs `plan`, `apply`, and then `plan --verbose`.
// Run it with `bun run report:preview`, and with `NO_COLOR=1` to see it without colors.
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"

import pc from "picocolors"
import { err } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { HostFunction } from "#hosts/host.ts"
import { host } from "#hosts/host.ts"
import type { HostReport } from "#hosts/run.ts"
import { hasPendingChange, runHost } from "#hosts/run.ts"
import { printTsinfraError } from "#report/errors.ts"
import { formatHostBlock, formatSummary } from "#report/format.ts"

interface Scenario {
  name: string
  target: string
  /** The modes the case shows up in, when it only means something in some of them. Defaults to both. */
  modes?: Mode[]
  /** Leaves the case out of the `--verbose` pass, for a case whose output would only be long there. */
  skipVerbose?: boolean
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

const BIG_VALUE_LINE_COUNT = 2000
const numberedLines = (prefix: string) =>
  Array.from({ length: BIG_VALUE_LINE_COUNT }, (_, index) => `${prefix} ${index}`).join("\n")

/**
 * Returns one example host for each way a block can look, with markers in `dir` so `apply` can make and see real
 * changes. Cases that only differ in their words, like two errors that both print as red lines, share one example.
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
      // `~` lines, a plural change count, and how a string value would change: `got` and `want` for one line, a diff for
      // several, with a hunk for each change far from the others. A yes-or-no check like "Install Caddy" shows nothing.
      name: "changes",
      target: "@local",
      fn: async (h) => {
        await h.ensure("Install Caddy", touchStep("caddy"))
        await h.ensure("Set the hostname", {
          check: `cat '${marker("hostname")}' 2>/dev/null || true`,
          want: "web1",
          fix: `printf web1 > '${marker("hostname")}'`,
        })
        const wantedConfig = CONFIG_LINES.map((line, index) =>
          index === 1 || index === 10 ? line.replace("default", "tuned") : line,
        )
        await h.ensure("Write the config", {
          check: `cat '${marker("config")}' 2>/dev/null || ${printLines(CONFIG_LINES)}`,
          want: wantedConfig.join("\n"),
          fix: `${printLines(wantedConfig)} > '${marker("config")}'`,
        })
      },
    },
    {
      // `?` lines with notes in one column, a note that names two steps, and a waiting count.
      name: "waiting",
      target: "@local",
      fn: async (h) => {
        const brew = await h.ensure("Install brew packages", touchStep("brew"))
        const fish = await h.ensure("Install fish", { needs: [brew], ...touchStep("fish") })
        await h.ensure("Install editor plugins", { needs: [brew, fish], ...touchStep("editor") })
      },
    },
    {
      // `>` lines, and with `--verbose`, `=` for an already-right step and an untriggered run, and `·` for a read.
      name: "runs",
      target: "@local",
      fn: async (h) => {
        const unit = await h.ensure("Write the sonarr unit", touchStep("unit"))
        await h.run("Reload systemd", "true", { after: [unit] })
        await h.run("Prune docker images", "true", { after: "always" })
        const caddyfile = await h.ensure("Write the Caddyfile", { check: "true", want: true, fix: "true" })
        await h.run("Restart caddy", "true", { after: [caddyfile] })
        await h.read("uname -m")
      },
    },
    {
      // No block, and an `unchanged` summary line, except with `--verbose`.
      name: "unchanged",
      target: "@local",
      fn: async (h) => {
        await h.ensure("Install git", { check: "true", want: true, fix: "true" })
      },
    },
    {
      // A diff too long to show, which becomes a note, except with `--verbose`, where its hunks show in full.
      name: "long-diff",
      target: "@local",
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
      skipVerbose: true,
      fn: async (h) => {
        await h.ensure("Write the big file", {
          check: `cat '${marker("big")}' 2>/dev/null || seq -f 'old %g' 0 ${BIG_VALUE_LINE_COUNT - 1}`,
          want: numberedLines("new"),
          fix: `seq -f 'new %g' 0 ${BIG_VALUE_LINE_COUNT - 1} > '${marker("big")}'`,
        })
      },
    },
    {
      // A block with "no steps", only with `--verbose`.
      name: "no-steps",
      target: "@local",
      fn: async () => {
        // A script with no steps.
      },
    },
    {
      // A quoted string value, and a one-line stderr.
      name: "string-value",
      target: "@local",
      modes: ["apply"],
      fn: async (h) => {
        await h.ensure("Start Sonarr", {
          check: "echo inactive; echo 'Unit sonarr.service could not be found.' >&2; exit 3",
          want: "active",
          fix: "true",
        })
      },
    },
    {
      // A multi-line string value as a diff, and a multi-line stderr lined up under its first line.
      name: "multi-line-value",
      target: "@local",
      modes: ["apply"],
      fn: async (h) => {
        await h.ensure("Set the allowed hosts", {
          check: String.raw`printf 'sonarr.lan\nradarr.lan\n'; printf 'warning: radarr.lan is deprecated\nsee the docs\n' >&2`,
          want: "sonarr.lan\nprowlarr.lan",
          fix: "true",
        })
      },
    },
    {
      // An exit code, which is italic because it isn't quoted.
      name: "exit-code-value",
      target: "@local",
      modes: ["apply"],
      fn: async (h) => {
        await h.ensure("Remove the old user", { check: "true", want: false, fix: "true" })
      },
    },
    {
      // A boolean, which is neither quoted nor italic.
      name: "boolean-value",
      target: "@local",
      modes: ["apply"],
      fn: async (h) => {
        await h.ensure("Enable the app", {
          check: async ({ read }) => (await read("echo false")) === "true",
          want: true,
          fix: "true",
        })
      },
    },
    {
      // An error with no facts under it, which is how every failure without a comparison looks.
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
      // A failed read, whose `!` line is named by its command.
      name: "command-error",
      target: "@local",
      fn: async (h) => {
        await h.read("cat /etc/tsinfra-preview.conf")
      },
    },
    {
      // A failure no step owns, named after the host's file, after a step that changed.
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
  return mode === "plan" && hostReports.some(({ stepRecords }) => hasPendingChange(stepRecords)) ? 2 : 0
}

/** Runs every scenario in `mode` and prints each block, the summary, and the exit code the CLI would return. */
interface PreviewPass {
  mode: Mode
  verbose?: boolean
}

const previewMode = async (previewPass: PreviewPass) => {
  const { mode, verbose = false } = previewPass
  const dir = await mkdtemp(path.join(os.tmpdir(), "tsinfra-preview-"))
  try {
    console.log(pc.cyan(pc.bold(`==== tsinfra ${mode}${verbose ? " --verbose" : ""} ====`)))
    console.log()

    const hostReports: HostReport[] = []
    const scenarios = createScenarios(dir).filter(
      ({ modes, skipVerbose }) => (!modes || modes.includes(mode)) && !(verbose && skipVerbose),
    )
    for (const { name, target, fn } of scenarios) {
      // oxlint-disable-next-line no-await-in-loop - hosts run one at a time, the same as the CLI
      const hostReport = await runHost({ name, ...host(target, fn) }, mode)
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
  const errors = [
    {
      label: "load-fails",
      error: err(
        "failed to load hosts:\nfailed to load host 'a' -> default must be an object (was missing)",
        undefined,
      ),
    },
    { label: "no-hosts", error: err("failed to discover hosts", err("no host files in 'hosts'", undefined)) },
  ]
  for (const { label, error } of errors) {
    console.log(pc.dim(label))
    printTsinfraError(error)
    console.log()
  }
}

const main = async (): Promise<number> => {
  await previewMode({ mode: "plan" })
  await previewMode({ mode: "apply" })
  await previewMode({ mode: "plan", verbose: true })
  previewOwnErrors()
  return 0
}

process.exitCode = await main()
