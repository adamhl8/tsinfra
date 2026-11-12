import { chmod, mkdtemp, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"

// Prints the report for one example host per way a block can look, to inspect the output by eye.
// It runs `plan` for what only shows in `plan`, then `apply` for the rest.
// Then it runs the sudo cases against a fake `sudo`, which accepts only the password `tsinfra`.
// Every pass shows the level its `-v` flags ask for, like the CLI, so `bun report-preview.ts -vv` checks level 2.
// Run it with `bask report-preview`, and with `NO_COLOR=1` to see it without colors.
// Run `bun report-preview.ts --sudo-prompt` to also get the sudo password prompt, and type at it.
import bun, { spawn } from "bun"
import pc from "picocolors"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HostFunction, HostSudo } from "#hosts/host.ts"
import { prepareHosts } from "#hosts/prepare/prepare.ts"
import { runHost } from "#hosts/run.ts"
import type { Mode } from "#mode.ts"
import { printTsinfraError } from "#report/errors.ts"
import type { HostBlock } from "#report/report.ts"
import { getExitCode, renderHostBlock, renderSummary, toHostBlock, toVerbosity } from "#report/report.ts"
import type { Verbosity } from "#report/verbosity.ts"
import { PUBLIC_FILE_MODE } from "#session/handlers/shared/filesystem/mode.ts"
import { runLocal } from "#transport/local.ts"

/**
 * One run of the preview: `plan` shows what only shows in `plan`, and `apply` the rest. `sudo` shows the sudo cases
 * that need no typing, and `sudoPrompt` the ones that prompt.
 */
type PreviewPass = "plan" | "apply" | "sudo" | "sudoPrompt"

interface Scenario {
  name: string
  target: string
  /** The pass the case shows up in. Defaults to `apply`. */
  pass?: PreviewPass
  /** The host's `sudo` option. Defaults to `false`. */
  sudo?: HostSudo
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

// Give a sudo case a script that does nothing visible, because what it shows is its preparation.
const readTrue: HostFunction = async (h) => {
  await h.read("true")
}

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
      // A `sudo: true` step's `[sudo]` from `-v`, in its own column, before the note of a step that waits.
      // The file waits in `plan`, so it runs no command, and the real `sudo` is never called.
      name: "sudo-option",
      target: "@local",
      pass: "plan",
      fn: async (h) => {
        const brew = await h.ensure("Install brew packages", touchStep("brew"))
        await h.file(marker("sudo-conf"), "a\n", { needs: [brew], sudo: true })
        await h.ensure("Install fish", { needs: [brew], ...touchStep("fish") })
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
      // A block with "no steps", which shows at every level.
      name: "no-steps",
      target: "@local",
      pass: "plan",
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
      // A host whose preparation failed, as `(preparation)` and its target in the value color, because its script never ran.
      // Give it a target with a space, because ssh rejects one before it reads any config or connects.
      name: "unreachable",
      target: "web lan",
      fn: async (h) => {
        await h.read("true")
      },
    },
    {
      // A wrong password from `host()`, which fails with only its own message.
      name: "wrong-sudo-password",
      target: "@local",
      pass: "sudo",
      sudo: { password: "wrong" },
      fn: readTrue,
    },
    {
      // A command's `sudo` that needs a password, on a host that doesn't declare `sudo`, with the hint under it.
      name: "undeclared-sudo",
      target: "@local",
      pass: "sudo",
      fn: async (h) => {
        await h.read("sudo true")
      },
    },
    {
      // A sudo that fails for another reason, which shows sudo's own output in the error chain.
      name: "not-in-sudoers",
      target: "@local",
      pass: "sudo",
      sudo: { password: "not-in-sudoers" },
      fn: readTrue,
    },
    {
      // Two hosts that prompt one after the other, to try the right password, a wrong one, three wrong ones, and Ctrl-D.
      name: "first-prompt",
      target: "@local",
      pass: "sudoPrompt",
      sudo: true,
      fn: readTrue,
    },
    {
      name: "second-prompt",
      target: "@local",
      pass: "sudoPrompt",
      sudo: true,
      fn: readTrue,
    },
    {
      // A failure no step owns, as `(host fn)` and the host's target with a note, after a step that changed.
      name: "script-error",
      target: "@local",
      fn: async (h) => {
        await h.ensure("Install Caddy", touchStep("throws"))
        throw new Error("the API token is missing")
      },
    },
  ]
}

const PASS_RUNS: Record<PreviewPass, { mode: Mode; fakeSudo: boolean }> = {
  plan: { mode: "plan", fakeSudo: false },
  apply: { mode: "apply", fakeSudo: false },
  sudo: { mode: "apply", fakeSudo: true },
  sudoPrompt: { mode: "apply", fakeSudo: true },
}

// Fail `-n`, and with `-S` accept only `tsinfra`, printing what real sudo prints for one wrong try.
// Answer the password `not-in-sudoers` the way sudo answers a user with no sudo rule.
const FAKE_SUDO = [
  "#!/bin/sh",
  "if [ \"$1\" = -n ]; then echo 'sudo: a password is required' >&2; exit 1; fi",
  "read -r password",
  '[ "$password" = tsinfra ] && exit 0',
  '[ "$password" = not-in-sudoers ] && { echo "$USER is not in the sudoers file." >&2; exit 1; }',
  String.raw`printf 'Sorry, try again.\n\nsudo: no password was provided\nsudo: 1 incorrect password attempt\n' >&2`,
  "exit 1",
].join("\n")

/**
 * Runs the scenarios of one pass at `verbosity`, and prints each block, the summary, and the exit code the CLI would
 * return.
 */
const previewPass = async (pass: PreviewPass, verbosity: Verbosity) => {
  const { mode, fakeSudo } = PASS_RUNS[pass]
  const dir = await mkdtemp(path.join(os.tmpdir(), "tsinfra-preview-"))
  try {
    const sudoNote = fakeSudo ? " (fake sudo, password 'tsinfra')" : ""
    const verbosityFlag = verbosity > 0 ? ` -${"v".repeat(verbosity)}` : ""
    console.log(pc.cyan(pc.bold(`==== tsinfra ${mode}${verbosityFlag}${sudoNote} ====`)))
    console.log()

    const hostBlocks: HostBlock[] = []
    const scenarios = createScenarios(dir).filter((scenario) => (scenario.pass ?? "apply") === pass)
    const loadedHosts = scenarios.map((scenario) =>
      Object.assign(scenario, { options: { sudo: scenario.sudo ?? false } }),
    )
    const hostEntries = await prepareHosts(loadedHosts)
    for (const hostEntry of hostEntries) {
      // oxlint-disable-next-line no-await-in-loop - hosts run one at a time, the same as the CLI
      const hostRecord = await runHost(hostEntry, mode)
      const hostBlock = toHostBlock(hostRecord)
      hostBlocks.push(hostBlock)

      const renderedHostBlock = renderHostBlock(hostBlock, { verbosity })
      if (renderedHostBlock) console.log(`${renderedHostBlock}\n`)
    }

    console.log(renderSummary(hostBlocks, mode))

    console.log(pc.dim(`\nexit code ${getExitCode(hostBlocks, mode)}`))
    console.log()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const SUDO_PROMPT_FLAG = "--sudo-prompt"

// Set this variable only in the child, so it tells the child that it runs the sudo passes, and where its fake `sudo` is.
const FAKE_SUDO_PATH_VARIABLE = "TSINFRA_PREVIEW_FAKE_SUDO"

/**
 * Runs the sudo passes in a child process, with a fake `sudo` first on `PATH` and a temp `HOME` for the askpass helper.
 * Set them when the child starts, because a command gets the environment tsinfra started with. Returns the child's exit
 * code.
 */
const previewSudoPasses = async (): Promise<number> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tsinfra-preview-sudo-"))
  try {
    const fakeSudoPath = path.join(dir, "bin", "sudo")
    await bun.write(fakeSudoPath, `${FAKE_SUDO}\n`)
    await chmod(fakeSudoPath, 0o755)

    // Pass the child every argument, so it shows the same level, and prompts only when asked.
    const child = spawn([process.execPath, import.meta.path, ...process.argv.slice(2)], {
      env: {
        ...process.env,
        PATH: `${path.dirname(fakeSudoPath)}:${process.env["PATH"]}`,
        HOME: dir,
        [FAKE_SUDO_PATH_VARIABLE]: fakeSudoPath,
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    })
    return await child.exited
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Runs the sudo passes, in the child that `previewSudoPasses` starts. Stops before any case if the fake isn't found. */
const runSudoPasses = async (verbosity: Verbosity): Promise<number> => {
  const foundSudo = await runLocal("command -v sudo")
  if (isErr(foundSudo) || foundSudo.stdout.trim() !== process.env[FAKE_SUDO_PATH_VARIABLE]) {
    printTsinfraError(
      err("the preview's fake sudo isn't first on PATH, so it stopped before running real sudo", undefined),
    )
    return 1
  }

  await previewPass("sudo", verbosity)
  if (process.argv.includes(SUDO_PROMPT_FLAG)) await previewPass("sudoPrompt", verbosity)
  return 0
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

// Match a run of short `-v` flags, like `-vv`, which counts as one level per `v`.
const SHORT_VERBOSE_FLAGS = /^-v+$/v

/** Returns the level the preview's `-v` and `--verbose` flags ask for, like the CLI, or an error for any other argument. */
const parseVerbosity = (args: string[]): Result<Verbosity> => {
  let flagCount = 0
  for (const arg of args) {
    if (arg === "--verbose") flagCount += 1
    else if (SHORT_VERBOSE_FLAGS.test(arg)) flagCount += arg.length - 1
    else if (arg !== SUDO_PROMPT_FLAG)
      return err(`unknown argument '${arg}', expected -v, -vv, -vvv, --verbose, or ${SUDO_PROMPT_FLAG}`, undefined)
  }

  return toVerbosity(flagCount)
}

const main = async (): Promise<number> => {
  const verbosity = parseVerbosity(process.argv.slice(2))
  if (isErr(verbosity)) {
    printTsinfraError(verbosity)
    return 1
  }

  if (process.env[FAKE_SUDO_PATH_VARIABLE] !== undefined) return runSudoPasses(verbosity)

  await previewPass("plan", verbosity)
  await previewPass("apply", verbosity)
  const sudoExitCode = await previewSudoPasses()
  previewOwnErrors()
  return sudoExitCode
}

process.exitCode = await main()
