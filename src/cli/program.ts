import { argument, command, constant, merge, message, object, option, or, string, text } from "@optique/core"
import { defineProgram } from "@optique/core/program"
import { path } from "@optique/run"

import { HOST_FILE_EXTENSION } from "#hosts/discover.ts"
import packageJson from "#package.json" with { type: "json" }

const DEFAULT_HOSTS_DIR = "hosts"

const hostOptions = object({
  hostsDir: option("--hosts-dir", path({ metavar: "DIR" }), {
    description: message`The directory of host files`,
  }).withDefault(DEFAULT_HOSTS_DIR),
  hosts: argument(string({ metavar: "HOST" }), {
    description: message`A host to run, by its file name without ${text(HOST_FILE_EXTENSION)} (default: every host)`,
  }).multiple(),
})

// Merge `hostOptions` into each command so hosts and options can only come after the command name.
const buildCommandOptions = <T extends string>(name: T) => merge(object({ command: constant(name) }), hostOptions)

const plan = command("plan", buildCommandOptions("plan"), {
  brief: message`Show what would change on each host`,
})

const apply = command("apply", buildCommandOptions("apply"), {
  brief: message`Make the changes on each host`,
})

const parser = or(plan, apply)

export const program = defineProgram({
  parser,
  metadata: {
    name: "tsinfra",
    brief: message`${text(packageJson.description)}`,
  },
})
