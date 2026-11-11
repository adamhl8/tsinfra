import type { Message } from "@optique/core"
import { argument, command, constant, merge, message, object, option, or, string, text } from "@optique/core"
import { defineProgram } from "@optique/core/program"
import { path } from "@optique/run"

import { HOST_SCRIPT_EXTENSION } from "#hosts/hosts.ts"
import type { Mode } from "#mode.ts"
import { MODES } from "#mode.ts"
import packageJson from "#package.json" with { type: "json" }
import { toVerbosity } from "#report/report.ts"

const DEFAULT_HOSTS_DIR = "hosts"

const hostOptions = object({
  hostsDir: option("--hosts-dir", path({ metavar: "DIR" }), {
    description: message`The directory of host scripts`,
  }).withDefault(DEFAULT_HOSTS_DIR),
  verbosity: option("-v", "--verbose", {
    description: message`Show more of each host's output. Use -vv and -vvv to show even more`,
  })
    .multiple()
    .map((flags) => toVerbosity(flags.length)),
  hosts: argument(string({ metavar: "HOST" }), {
    description: message`A host to run, by its file name without ${text(HOST_SCRIPT_EXTENSION)} (default: every host)`,
  }).multiple(),
})

const MODE_BRIEFS: Record<Mode, Message> = {
  plan: message`Show what would change on each host`,
  apply: message`Make the changes on each host`,
}

// Merge `hostOptions` into each command so hosts and options can only come after the command name.
const buildCommandOptions = (mode: Mode) => merge(object({ mode: constant(mode) }), hostOptions)

const buildCommand = (mode: Mode) => command(mode, buildCommandOptions(mode), { brief: MODE_BRIEFS[mode] })

const parser = or(...MODES.map(buildCommand))

export const program = defineProgram({
  parser,
  metadata: {
    name: "tsinfra",
    brief: message`${text(packageJson.description)}`,
  },
})
