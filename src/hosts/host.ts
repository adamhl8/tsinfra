import { type } from "arktype"

import type { Host } from "#session/session.ts"

export type HostFunction = (h: Host) => Promise<void>

/** What a host script exports: where its commands run, and the function that configures it. */
export interface HostDefinition {
  target: string
  fn: HostFunction
}

export const hostDefinitionSchema = type.declare<HostDefinition>().type({
  target: "string",
  // Type `fn` as a `HostFunction` because only "is a function" can be validated at runtime.
  fn: type("Function").as<HostFunction>(),
})

/** Defines a host. A host script must `export default` what this function returns. */
export const host = (target: string, fn: HostFunction): HostDefinition => ({ target, fn })
