import { argument, command, constant, merge, message, object, option, or, string, text } from "@optique/core"
import { defineProgram } from "@optique/core/program"
import { path } from "@optique/run"

import packageJson from "#package.json" with { type: "json" }

const hostOptions = object({
  hostsDir: option("--hosts-dir", path({ metavar: "DIR" }), {
    description: message`The directory of host files`,
  }).withDefault("hosts"),
  hosts: argument(string({ metavar: "HOST" }), {
    description: message`A host to run, by its file name without ${text(".ts")} (default: every host)`,
  }).multiple(),
})

// Merge `hostOptions` into each command so hosts and options can only come after the command name.
const commandOptions = <T extends string>(name: T) => merge(object({ command: constant(name) }), hostOptions)

const plan = command("plan", commandOptions("plan"), {
  brief: message`Show what would change on each host`,
})

const apply = command("apply", commandOptions("apply"), {
  brief: message`Make the changes on each host`,
})

export const program = defineProgram({
  parser: or(plan, apply),
  metadata: {
    name: "tsinfra",
    version: packageJson.version,
    brief: message`${text(packageJson.description)}`,
  },
})
