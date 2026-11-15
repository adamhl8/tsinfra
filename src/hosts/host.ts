import { regex } from "arkregex"
import { type } from "arktype"

import type { Host } from "#session/session.ts"

/** What a host script exports: the host's config, and the function that configures it. */
export interface HostDefinition {
  config: HostConfig
  fn: HostFunction
}

export type HostFunction = (h: Host) => Promise<void>

/** What a host is called, where its commands run, and how it runs them. */
export interface HostConfig extends HostIdentity, HostOptions {}

/** What a host is called, and where its commands run. */
export interface HostIdentity {
  /**
   * The host's name, which the report shows and the command line picks it by. Its saved state is kept under it, so it
   * must be unique across host scripts. It has letters, digits, `.`, `_`, and `-`, and starts with a letter or a
   * digit.
   */
  name: string
  /** Where the host's commands run: `@local` for the control machine, or an ssh destination like `sonarr.lan`. */
  target: string
}

/** How a host runs its commands. */
export interface HostOptions {
  /**
   * Declares that the host's script uses sudo, so preparation makes sure sudo works before any host changes anything.
   * Set it even with passwordless sudo, and give `{ password }` only when the run can't prompt (see
   * `docs/transport.md`).
   */
  sudo?: HostSudo
}

/**
 * Declares the host's sudo with `true`, or with `{ password }` to also give tsinfra the password sudo asks for.
 * `false`, the default, means preparation doesn't check sudo.
 */
export type HostSudo = boolean | { password: string }

// Keep the name to characters a file name and the command line both take, because the saved state file is named by it.
// Leave out the `v` flag, because it needs `-` escaped, and `regex` can't infer the type from `String.raw`.
const hostNameSchema = type(regex("^[A-Za-z0-9][A-Za-z0-9._-]*$")).describe(
  "a name of letters, digits, '.', '_', and '-', starting with a letter or a digit",
)

const hostIdentitySchema = type.declare<HostIdentity>().type({ name: hostNameSchema, target: "string" })

const hostSudoSchema = type("boolean").or({ password: "string > 0" })

const hostOptionsSchema = type.declare<HostOptions>().type({ "sudo?": hostSudoSchema })

// Fill the defaults on the whole config, because ArkType infers an intersection with a piped schema as the pipe's
// output alone, which would drop `name` and `target`.
const hostConfigSchema = hostIdentitySchema
  .and(hostOptionsSchema)
  .pipe((hostConfig) => ({ ...hostConfig, sudo: hostConfig.sudo ?? false }))

export const hostDefinitionSchema = type({
  config: hostConfigSchema,
  // Type `fn` as a `HostFunction` because only "is a function" can be validated at runtime.
  fn: type("Function").as<HostFunction>(),
})

export type ValidHostDefinition = typeof hostDefinitionSchema.infer

/** A host's options once they're validated, with their defaults filled in. */
export type ValidHostOptions = Pick<ValidHostDefinition["config"], keyof HostOptions>

/** Defines a host. A host script must `export default` what this function returns. */
export const host = (config: HostConfig, fn: HostFunction): HostDefinition => ({ config, fn })
