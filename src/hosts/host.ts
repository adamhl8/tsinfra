import { type } from "arktype"

import type { Host } from "#session/session.ts"

export type HostFunction = (h: Host) => Promise<void>

/**
 * Declares the host's sudo with `true`, or with `{ password }` to also give tsinfra the password sudo asks for.
 * `false`, the default, means preparation doesn't check sudo.
 */
export type HostSudo = boolean | { password: string }

/** What a host script can set besides its target and function. */
export interface HostOptions {
  /**
   * Declares that the host's script uses sudo, so preparation makes sure sudo works before any host changes anything.
   * Set it even with passwordless sudo, and give `{ password }` only when the run can't prompt (see
   * `docs/transport.md`).
   */
  sudo?: HostSudo
}

/** What a host script exports: where its commands run, the function that configures it, and its options. */
export interface HostDefinition {
  target: string
  fn: HostFunction
  options: HostOptions
}

const hostSudoSchema = type("boolean").or({ password: "string > 0" })

export const hostDefinitionSchema = type
  .declare<HostDefinition>()
  .type({
    target: "string",
    // Type `fn` as a `HostFunction` because only "is a function" can be validated at runtime.
    fn: type("Function").as<HostFunction>(),
    options: { "sudo?": hostSudoSchema },
  })
  .pipe((hostDefinition) => ({ ...hostDefinition, options: { sudo: false, ...hostDefinition.options } }))

export type ValidHostDefinition = typeof hostDefinitionSchema.infer

/** A host's options once they're validated, with their defaults filled in. */
export type ValidHostOptions = ValidHostDefinition["options"]

/** Defines a host. A host script must `export default` what this function returns. */
export const host = (target: string, fn: HostFunction, options: HostOptions = {}): HostDefinition => ({
  target,
  fn,
  options,
})
