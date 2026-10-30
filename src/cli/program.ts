import type { Message } from "@optique/core"
import { argument, command, constant, merge, message, object, option, or, string, text } from "@optique/core"
import { defineProgram } from "@optique/core/program"
import { path } from "@optique/run"

import { HOST_FILE_EXTENSION } from "#hosts/discover.ts"
import packageJson from "#package.json" with { type: "json" }

const MODES = ["plan", "apply"] as const
export type Mode = (typeof MODES)[number]

const DEFAULT_HOSTS_DIR = "hosts"

const hostOptions = object({
  hostsDir: option("--hosts-dir", path({ metavar: "DIR" }), {
    description: message`The directory of host files`,
  }).withDefault(DEFAULT_HOSTS_DIR),
  hosts: argument(string({ metavar: "HOST" }), {
    description: message`A host to run, by its file name without ${text(HOST_FILE_EXTENSION)} (default: every host)`,
  }).multiple(),
})

const MODE_BRIEFS = {
  plan: message`Show what would change on each host`,
  apply: message`Make the changes on each host`,
} as const satisfies Record<Mode, Message>

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
