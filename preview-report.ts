// Prints the report for a set of example hosts in `plan` and then `apply`, to inspect the output by eye.
// Run it with `bun run report:preview`, and with `NO_COLOR=1` to see it without colors.
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"

import pc from "picocolors"
import { attempt, err } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import type { HostFunction } from "#hosts/host.ts"
import { host } from "#hosts/host.ts"
import type { HostReport } from "#hosts/run.ts"
import { hasPendingChange, runHost } from "#hosts/run.ts"
import { formatHostBlock, formatSummary, printTsinfraError } from "#report/output.ts"

interface Scenario {
  name: string
  target: string
  /** The modes the case shows up in, when it only means something in some of them. Defaults to both. */
  modes?: Mode[]
  fn: HostFunction
}

/** Returns the example hosts, with markers in `dir` so `apply` can make and see real changes. */
const createScenarios = (dir: string): Scenario[] => {
  const marker = (file: string) => path.join(dir, file)

  return [
    {
      name: "changes",
      target: "@local",
      fn: async (h) => {
        await h.ensure("Install Caddy", { check: `test -f '${marker("caddy")}'`, fix: `touch '${marker("caddy")}'` })
        await h.ensureValue("Set the hostname", {
          read: `cat '${marker("hostname")}' 2>/dev/null || true`,
          want: "web1",
          fix: `printf web1 > '${marker("hostname")}'`,
        })
      },
    },
    {
      name: "one-change",
      target: "@local",
      fn: async (h) => {
        await h.ensure("Create the data dir", {
          check: `test -d '${marker("data")}'`,
          fix: `mkdir '${marker("data")}'`,
        })
      },
    },
    {
      name: "runs",
      target: "@local",
      fn: async (h) => {
        const unit = await h.ensure("Write the sonarr unit", {
          check: `test -f '${marker("unit")}'`,
          fix: `touch '${marker("unit")}'`,
        })
        await h.run("Reload systemd", "true", { when: unit.changed })
        await h.run("Prune docker images", "true", { when: true })
        await h.run("Restart caddy", "true", { when: false })
      },
    },
    {
      name: "all-ok",
      target: "@local",
      fn: async (h) => {
        await h.ensure("Install git", { check: "true", fix: "true" })
        await h.read("uname -m")
        await h.run("Reload systemd", "true", { when: false })
      },
    },
    {
      name: "fix-fails",
      target: "@local",
      modes: ["apply"],
      fn: async (h) => {
        await h.ensure("Start sonarr", {
          check: "false",
          fix: "echo 'Unit sonarr.service not found.' >&2; exit 5",
        })
      },
    },
    {
      name: "still-differs",
      target: "@local",
      modes: ["apply"],
      fn: async (h) => {
        await h.ensureValue("Set the timezone", { read: "echo UTC", want: "America/New_York", fix: "true" })
      },
    },
    {
      name: "check-throws",
      target: "@local",
      fn: async (h) => {
        await h.ensure("Enable the app", {
          check: () => {
            throw new Error("Unexpected token '}' in JSON at position 41")
          },
          fix: "true",
        })
      },
    },
    {
      name: "read-fails",
      target: "@local",
      fn: async (h) => {
        await h.read("cat /etc/tsinfra-preview.conf")
      },
    },
    {
      name: "script-throws",
      target: "@local",
      fn: async (h) => {
        await h.ensure("Install Caddy", { check: `test -f '${marker("throws")}'`, fix: `touch '${marker("throws")}'` })
        throw new Error("the API token is missing")
      },
    },
    {
      name: "steps-at-once",
      target: "@local",
      fn: async (h) => {
        await Promise.allSettled([
          h.ensure("Install Caddy", { check: "sleep 0.1", fix: "true" }),
          h.ensure("Install git", { check: "true", fix: "true" }),
        ])
      },
    },
    {
      name: "nested-step",
      target: "@local",
      fn: async (h) => {
        await h.ensure("Set up sonarr", {
          check: async () => {
            await h.ensure("Create the sonarr user", { check: "true", fix: "true" })
            return false
          },
          fix: "true",
        })
      },
    },
    {
      name: "caught-exec",
      target: "@local",
      modes: ["apply"],
      fn: async (h) => {
        await h.ensure("Install the package", {
          check: "false",
          fix: async ({ exec }) => {
            await attempt(async () => exec("echo 'E: Unable to locate package nope' >&2; exit 100"))
          },
        })
      },
    },
    {
      name: "unreachable",
      target: "web.lan",
      fn: async (h) => {
        await h.read("uname -m")
      },
    },
  ]
}

/** Returns the exit code the CLI would return for these reports. */
const getExitCode = (hostReports: HostReport[], mode: Mode) => {
  if (hostReports.some(({ failure }) => failure)) return 1
  return mode === "plan" && hostReports.some(({ stepRecords }) => hasPendingChange(stepRecords)) ? 2 : 0
}

/** Runs every scenario in `mode` and prints each block, the summary, and the exit code the CLI would return. */
const previewMode = async (mode: Mode) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tsinfra-preview-"))
  try {
    console.log(pc.cyan(pc.bold(`==== tsinfra ${mode} ====`)))
    console.log()

    const hostReports: HostReport[] = []
    const scenarios = createScenarios(dir).filter(({ modes }) => !modes || modes.includes(mode))
    for (const { name, target, fn } of scenarios) {
      // oxlint-disable-next-line no-await-in-loop - hosts run one at a time, the same as the CLI
      const hostReport = await runHost({ name, ...host(target, fn) }, mode)
      hostReports.push(hostReport)

      const block = formatHostBlock(hostReport)
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
  await previewMode("plan")
  await previewMode("apply")
  previewOwnErrors()
  return 0
}

process.exitCode = await main()
