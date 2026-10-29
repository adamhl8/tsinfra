// Use `Symbol.for` so the check still passes when the CLI and a host file load different copies of tsinfra.
const HOST_DEFINITION = Symbol.for("tsinfra.host-definition")

export type HostFunction = () => Promise<void>

export interface HostDefinition {
  readonly [HOST_DEFINITION]: true
  readonly target: string
  readonly fn: HostFunction
}

/** Defines a host. A host file default exports the result. */
export const host = (target: string, fn: HostFunction): HostDefinition => ({ [HOST_DEFINITION]: true, target, fn })

export const isHostDefinition = (value: unknown): value is HostDefinition =>
  typeof value === "object" && value !== null && HOST_DEFINITION in value
