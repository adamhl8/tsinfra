import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import process from "node:process"

// Prints the report with every element and every message tsinfra writes at least once, to inspect the output by eye.
// It runs `plan` for what only shows in `plan`, then `apply` for the rest.
// Every pass shows the level its `-v` flags ask for, like the CLI, so `bun report-preview.ts -vv` shows level 2, and
// each level adds to the same hosts.
// Run it with `bask report-preview`, and with `NO_COLOR=1` to see it without colors.
// Run `bun report-preview.ts --sudo-prompt` to also get the sudo password prompt, against a fake `sudo` that accepts
// only the password `tsinfra`, and type at it.
import bun, { spawn } from "bun"
import pc from "picocolors"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HostFunction, HostSudo } from "#hosts/host.ts"
import { prepareHosts } from "#hosts/prepare/prepare.ts"
import { runHost } from "#hosts/run.ts"
import type { Mode } from "#mode.ts"
import type { HostBlock } from "#report/report.ts"
import {
  getExitCode,
  printTsinfraError,
  renderHostBlock,
  renderSummary,
  toHostBlock,
  toVerbosity,
} from "#report/report.ts"
import type { Verbosity } from "#report/verbosity.ts"
import { PUBLIC_FILE_MODE } from "#session/handlers/shared/filesystem/mode.ts"
import type { HostRecord } from "#session/session.ts"
import { createHostRecord } from "#session/session.ts"
import { runLocal } from "#transport/local.ts"

/** One run of the preview: `plan` shows what only shows in `plan`, `apply` the rest, and `sudoPrompt` the prompt. */
type PreviewPass = "plan" | "apply" | "sudoPrompt"

interface Scenario {
  name: string
  target: string
  pass: PreviewPass
  /** The host's `sudo` option. Defaults to `false`. */
  sudo?: HostSudo
  fn: HostFunction
}

// Print numbered lines with `awk`, because BusyBox's `seq` has no `-f`.
const printNumberedLines = (prefix: string, count: number) =>
  `awk 'BEGIN { for (i = 0; i < ${count}; i++) print "${prefix} " i }'`

const numberedLines = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index}`).join("\n")

// A 12-line config, and the version the script wants, with two changes far enough apart to make two hunks.
const CONFIG_LINES = Array.from({ length: 12 }, (_, index) => `setting_${index + 1} = default`)
const WANTED_CONFIG_LINES = CONFIG_LINES.map((line, index) =>
  index === 1 || index === 10 ? line.replace("default", "tuned") : line,
)

// A 40-line config, and the version the script wants, with enough changes that its diff is too long to show.
const optionLine = (number: number, value: string) => `option_${String(number).padStart(2, "0")} = ${value}`
const SITE_CONFIG = Array.from({ length: 40 }, (_, index) => optionLine(index + 1, index % 3 === 0 ? "on" : "off"))
const WANTED_SITE_CONFIG = SITE_CONFIG.flatMap((line, index) => {
  const number = index + 1
  if (number === 3 || number === 4 || number === 38) return [optionLine(number, "tuned")]
  if (number === 15) return [line, "option_15b = on", "option_15c = on"]
  if (number === 28) return []
  return [line]
})

// Make a value big enough that comparing it takes too long, which only shows below `-vv`, where the time limit applies.
const BIG_VALUE_LINE_COUNT = 2000
// Make a file bigger than the 100 kB the report diffs.
const TOO_LARGE_BYTES = 120_000

// Pick a group the user is in besides their own, so a `group:` row can change in `apply` without root.
const OTHER_GROUP_ID = process.getgroups?.().find((gid) => gid !== os.userInfo().gid) ?? os.userInfo().gid

/**
 * Returns the example hosts, with markers in `dir` so `apply` can make and see real changes. A host stops at its first
 * failure, so each kind of failure has a host of its own, and every element that needs no failure is on `elements`.
 */
const createScenarios = (dir: string, verbosity: Verbosity): Scenario[] => {
  const marker = (file: string) => path.join(dir, file)
  const touchStep = (file: string) => ({
    want: true,
    check: `test -f '${marker(file)}'`,
    fix: `touch '${marker(file)}'`,
  })
  // Write `lines` to a marker until it exists, so the check reads `fallback` before the fix and the marker after it.
  const linesStep = (file: string, fallback: string, wanted: string) => ({
    want: wanted,
    check: `cat '${marker(file)}' 2>/dev/null || ${fallback}`,
    fix: `printf '%s' '${wanted === "" ? "" : `${wanted}\n`}' > '${marker(file)}'`,
  })

  return [
    {
      // `~ change`, `? waiting` with a `needs` note naming two steps, a waiting `sudo: true` file, whose options line
      // shows from `-v` without calling sudo, the waiting count, and the plan reminder.
      name: "plan",
      target: "@local",
      pass: "plan",
      fn: async (h) => {
        const brew = await h.ensure("Install brew packages", touchStep("brew"))
        const fish = await h.ensure("Install fish", { needs: [brew], ...touchStep("fish") })
        await h.ensure("Install editor plugins", { needs: [brew, fish], ...touchStep("editor") })
        await h.file(marker("sudo-conf"), "a\n", { needs: [brew], sudo: true })
      },
    },
    {
      // One bare step for each status `apply` shows, and the summary's count.
      name: "statuses",
      target: "@local",
      pass: "apply",
      fn: async (h) => {
        const caddy = await h.ensure("Install Caddy", touchStep("caddy"))
        await h.run("Reload Caddy", "true", { after: [caddy] })
        await h.ensure("Install git", { want: true, check: "true", fix: "true" })
        await h.read("uname -m")
        await h.inspect("test -d /etc")
      },
    },
    {
      // Every element on steps that succeed. `ensure` strings: `got:` and `want:` rows, multi-line rows with a lone side,
      // `(empty)` for a value and a line, a quoted trailing space, and the notes for too many lines and a slow compare.
      // `ensure` lists: `missing:` and `extra:` rows, and `want: []` with only `extra:`.
      // `ensure` records: a row per key that differs, with `(none)` for a key only one side has.
      // `file`: a diff with two hunks, `mode:` and a numeric `group:`, the note for a long diff and a slow one, and each
      // content description. `link`: a changed target, both replacements, and a missing target with its warning, on a
      // step that changes and one that was already right. A triggered multi-line run and one that didn't trigger.
      // A read with `env` and `secretEnv`, with a multi-line, an empty, a padded, and a masked value.
      // Commands at `-vv`, and their phases, output, and labels at `-vvv`.
      name: "elements",
      target: "@local",
      pass: "apply",
      fn: async (h) => {
        await bun.write(marker("app.conf"), `${CONFIG_LINES.join("\n")}\n`)
        await chmod(marker("app.conf"), 0o600)
        await bun.write(marker("site.conf"), `${SITE_CONFIG.join("\n")}\n`)
        await bun.write(marker("token"), "old-token\n")
        await bun.write(marker("image.bin"), "old\0image\n")
        await bun.write(marker("dump.sql"), "a".repeat(TOO_LARGE_BYTES))
        await bun.write(marker("dotfile"), "set -x EDITOR vim\n")
        await bun.write(marker("old-dotfile"), "set -x EDITOR nano\n")
        await bun.write(marker("real-file"), "a file where the link goes\n")
        await mkdir(marker("empty-dir"))
        await symlink(marker("old-dotfile"), marker("moved-link"))
        await symlink(marker("missing-dotfile"), marker("broken-link"))

        await h.ensure("Set the hostname", linesStep("hostname", "true", "web1"))
        const packages = await h.ensure(
          "Upgrade packages",
          linesStep("outdated", String.raw`printf 'fd\n\nripgrep \n'`, ""),
        )
        await h.ensure("Install packages", linesStep("installed", String.raw`printf 'fd\njq\n'`, "fd\njq\nripgrep"))
        await h.ensure("Sync the package list", {
          want: ["fd", "jq", "ripgrep"],
          check: String.raw`cat '${marker("package-list")}' 2>/dev/null || printf 'zsh\nfd\nbat\n'`,
          fix: async ({ exec }, { missing, extra }) => {
            await exec(`echo 'installing ${missing.join(" ")}, removing ${extra.join(" ")}'`)
            await exec(String.raw`printf 'fd\njq\nripgrep\n' > '${marker("package-list")}'`)
          },
        })
        await h.ensure("Upgrade brew packages", {
          want: [],
          check: `cat '${marker("outdated-list")}' 2>/dev/null || printf 'node\\npython\\n'`,
          fix: `: > '${marker("outdated-list")}'`,
        })
        await h.ensure("Sync the versions", {
          want: { zx: "8.8.1", pnpm: "11.2.0", fd: "10.0.0" },
          check: async ({ read }) => {
            const listing = await read(
              `cat '${marker("versions")}' 2>/dev/null || echo 'typescript=5.9.2 pnpm=11.1.0 fd=10.0.0'`,
            )
            return Object.fromEntries(
              listing.split(" ").map((entry) => {
                const [name = "", version = ""] = entry.split("=")
                return [name, version] as const
              }),
            )
          },
          fix: `echo 'zx=8.8.1 pnpm=11.2.0 fd=10.0.0' > '${marker("versions")}'`,
        })
        await h.ensure(
          "Write the hosts list",
          linesStep("hosts", printNumberedLines("old", 8), numberedLines("new", 8)),
        )
        if (verbosity < 2) {
          await h.ensure(
            "Write the big list",
            linesStep(
              "big",
              printNumberedLines("old", BIG_VALUE_LINE_COUNT),
              numberedLines("new", BIG_VALUE_LINE_COUNT),
            ),
          )
        }

        await h.file(marker("app.conf"), `${WANTED_CONFIG_LINES.join("\n")}\n`, {
          mode: PUBLIC_FILE_MODE,
          group: OTHER_GROUP_ID,
        })
        await h.file(marker("site.conf"), `${WANTED_SITE_CONFIG.join("\n")}\n`)
        if (verbosity < 2) {
          await bun.write(marker("big.conf"), `${numberedLines("old", BIG_VALUE_LINE_COUNT)}\n`)
          await h.file(marker("big.conf"), `${numberedLines("new", BIG_VALUE_LINE_COUNT)}\n`)
        }
        await h.file(marker("new.conf"), "enabled = true\n")
        await h.file(marker("token"), "new-token\n", { secret: true })
        await h.file(marker("image.bin"), "new\0image\n")
        await h.file(marker("dump.sql"), "b".repeat(TOO_LARGE_BYTES))

        await h.link(marker("moved-link"), marker("dotfile"))
        await h.link(marker("real-file"), marker("dotfile"), { force: true })
        await h.link(marker("empty-dir"), marker("dotfile"), { force: true })
        await h.link(marker("new-link"), marker("missing-config "))
        await h.link(marker("broken-link"), marker("missing-dotfile"))

        await h.run("Reload the shell", "echo reloading\necho done", { after: [packages] })
        const git = await h.ensure("Install git", { want: true, check: "true", fix: "true" })
        await h.run("Configure git", "true", { after: [git] })

        await h.read(String.raw`printf '%s\n' "$URL" "$NOTES"; echo 'a warning on stderr' >&2`, {
          env: { URL: "https://example.com", NOTES: "first line\nsecond line", EMPTY: "", PADDED: " padded" },
          secretEnv: { TOKEN: "s3cret-token" },
        })
      },
    },
    {
      // A block with "no steps", which shows at every level, and the summary's `unchanged`.
      name: "no-steps",
      target: "@local",
      pass: "apply",
      fn: async () => {
        // A script with no steps.
      },
    },
    {
      // A step that still differs after its fix, with italic exit codes, and a `command:` and `stderr:` row for each
      // phase that ran one command: the fix, and the multi-line check after it, its later lines lined up.
      name: "stderr",
      target: "@local",
      pass: "apply",
      fn: async (h) => {
        await h.ensure("Enable the app", {
          want: true,
          check: "echo 'checking the app'\necho 'appctl: the app is disabled' >&2\nexit 1",
          fix: "echo 'appctl: warning: config is read-only' >&2",
        })
      },
    },
    {
      // A step that still differs after its fix, with italic booleans, and the note for each phase that ran several
      // commands, one during the fix and one after it.
      name: "stderr-notes",
      target: "@local",
      pass: "apply",
      fn: async (h) => {
        await h.ensure("App is healthy", {
          want: true,
          check: async ({ inspect }) => {
            await inspect("echo 'curl: (7) Failed to connect' >&2; exit 7")
            await inspect("true")
            return false
          },
          fix: async ({ exec }) => {
            await exec("echo 'appctl: warning: config is read-only' >&2")
            await exec("true")
          },
        })
      },
    },
    {
      // A fix that fails, with a `secretEnv` value in its error as `[MASKED]`, and from `-v`, the values from before the
      // fix under their note.
      name: "failed-fix",
      target: "@local",
      pass: "apply",
      fn: async (h) => {
        await h.ensure("Set the timezone", {
          want: "UTC",
          check: "echo America/New_York",
          fix: 'echo "the token $TOKEN was rejected" >&2; exit 1',
          secretEnv: { TOKEN: "s3cret-token" },
        })
      },
    },
    {
      // A failure no step owns, as `(host fn)` and the host's target with its note, after a step that changed.
      name: "host-fn",
      target: "@local",
      pass: "apply",
      fn: async (h) => {
        await h.ensure("Install Caddy", touchStep("throws"))
        throw new Error("the API token is missing")
      },
    },
    {
      // Two hosts that prompt one after the other, to try the right password, a wrong one, three wrong ones, and Ctrl-D.
      name: "first-prompt",
      target: "@local",
      pass: "sudoPrompt",
      sudo: true,
      fn: async (h) => {
        await h.read("true")
      },
    },
    {
      name: "second-prompt",
      target: "@local",
      pass: "sudoPrompt",
      sudo: true,
      fn: async (h) => {
        await h.read("true")
      },
    },
  ]
}

/**
 * Returns a host whose preparation failed with every hint, as a record, because the ssh hints need a real ssh setup. It
 * shows `(preparation)` and the host's target, and from `-vv`, the commands preparation ran, by their labels.
 */
const createHintsRecord = (): HostRecord => ({
  ...createHostRecord("hints", "web.lan"),
  preparationCommands: [
    { cmd: "ssh -G -T -- web.lan", label: "ssh config" },
    { cmd: String.raw`printf '%s\n' "$HOME"`, label: "home directory" },
  ],
  failure: {
    kind: "preparation",
    error: new Error("Host key verification failed."),
    hints: [{ kind: "changedHostKey" }, { kind: "unknownHostKey", target: "web.lan" }, { kind: "sudoOption" }],
  },
})

const PASS_MODES: Record<PreviewPass, Mode> = {
  plan: "plan",
  apply: "apply",
  sudoPrompt: "apply",
}

// Fail `-n`, and with `-S` accept only `tsinfra`, printing what real sudo prints for one wrong try.
const FAKE_SUDO = [
  "#!/bin/sh",
  "if [ \"$1\" = -n ]; then echo 'sudo: a password is required' >&2; exit 1; fi",
  "read -r password",
  '[ "$password" = tsinfra ] && exit 0',
  String.raw`printf 'Sorry, try again.\n\nsudo: no password was provided\nsudo: 1 incorrect password attempt\n' >&2`,
  "exit 1",
].join("\n")

/** Prints a host's block, if it has one at `verbosity`, and returns the block for the summary. */
const printHostBlock = (hostRecord: HostRecord, verbosity: Verbosity): HostBlock => {
  const hostBlock = toHostBlock(hostRecord)
  const renderedHostBlock = renderHostBlock(hostBlock, { verbosity })
  if (renderedHostBlock) console.log(`${renderedHostBlock}\n`)
  return hostBlock
}

/**
 * Runs the scenarios of one pass at `verbosity`, and prints each block, the summary, and the exit code the CLI would
 * return. `apply` also prints the hints host, after the hosts that ran.
 */
const previewPass = async (pass: PreviewPass, verbosity: Verbosity) => {
  const mode = PASS_MODES[pass]
  const dir = await mkdtemp(path.join(os.tmpdir(), "tsinfra-preview-"))
  try {
    const sudoNote = pass === "sudoPrompt" ? " (fake sudo, password 'tsinfra')" : ""
    const verbosityFlag = verbosity > 0 ? ` -${"v".repeat(verbosity)}` : ""
    console.log(pc.cyan(pc.bold(`==== tsinfra ${mode}${verbosityFlag}${sudoNote} ====`)))
    console.log()

    const scenarios = createScenarios(dir, verbosity).filter((scenario) => scenario.pass === pass)
    const loadedHosts = scenarios.map((scenario) =>
      Object.assign(scenario, { options: { sudo: scenario.sudo ?? false } }),
    )
    const hostEntries = await prepareHosts(loadedHosts)
    const hostBlocks: HostBlock[] = []
    for (const hostEntry of hostEntries) {
      // oxlint-disable-next-line no-await-in-loop - hosts run one at a time, the same as the CLI
      hostBlocks.push(printHostBlock(await runHost(hostEntry, mode), verbosity))
    }
    if (pass === "apply") hostBlocks.push(printHostBlock(createHintsRecord(), verbosity))

    console.log(renderSummary(hostBlocks, mode))

    console.log(pc.dim(`\nexit code ${getExitCode(hostBlocks, mode)}`))
    console.log()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const SUDO_PROMPT_FLAG = "--sudo-prompt"

// Set this variable only in the child, so it tells the child that it runs the prompt pass, and where its fake `sudo` is.
const FAKE_SUDO_PATH_VARIABLE = "TSINFRA_PREVIEW_FAKE_SUDO"

/**
 * Runs the prompt pass in a child process, with a fake `sudo` first on `PATH` and a temp `HOME` for the askpass helper.
 * Set them when the child starts, because a command gets the environment tsinfra started with. Returns the child's exit
 * code.
 */
const previewSudoPrompt = async (): Promise<number> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tsinfra-preview-sudo-"))
  try {
    const fakeSudoPath = path.join(dir, "bin", "sudo")
    await bun.write(fakeSudoPath, `${FAKE_SUDO}\n`)
    await chmod(fakeSudoPath, 0o755)

    // Pass the child every argument, so it shows the same level.
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

/** Runs the prompt pass, in the child that `previewSudoPrompt` starts. Stops before any host if the fake isn't found. */
const runSudoPromptPass = async (verbosity: Verbosity): Promise<number> => {
  const foundSudo = await runLocal("command -v sudo")
  if (isErr(foundSudo) || foundSudo.stdout.trim() !== process.env[FAKE_SUDO_PATH_VARIABLE]) {
    printTsinfraError(
      err("the preview's fake sudo isn't first on PATH, so it stopped before running real sudo", undefined),
    )
    return 1
  }

  await previewPass("sudoPrompt", verbosity)
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

  if (process.env[FAKE_SUDO_PATH_VARIABLE] !== undefined) return runSudoPromptPass(verbosity)

  await previewPass("plan", verbosity)
  await previewPass("apply", verbosity)
  const sudoExitCode = process.argv.includes(SUDO_PROMPT_FLAG) ? await previewSudoPrompt() : 0
  previewOwnErrors()
  return sudoExitCode
}

process.exitCode = await main()
