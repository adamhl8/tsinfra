import { type } from "arktype"

export const MODES = ["plan", "apply"] as const
export type Mode = (typeof MODES)[number]

export interface Host {
  readonly name: string
}

export type HostFunction = (h: Host) => Promise<void>

export const hostDefinitionSchema = type({
  target: "string",
  // Type `fn` as a `HostFunction` because only "is a function" can be checked at runtime.
  fn: type("Function").as<HostFunction>(),
})

export type HostDefinition = typeof hostDefinitionSchema.infer

/** Defines a host. A host file must `export default` what this function returns. */
export const host = (target: string, fn: HostFunction): HostDefinition => ({ target, fn })
