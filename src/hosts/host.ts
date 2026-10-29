import { type } from "arktype"

export const MODES = ["plan", "apply"] as const
export type Mode = (typeof MODES)[number]

export interface Host {
  readonly name: string
  /**
   * Runs `cmd` on the host and returns its stdout without trailing newlines. It must not change anything, because it
   * also runs during `plan`.
   *
   * A non-zero exit fails the host and throws. Catching it does not recover the host. Append `|| true` to `cmd` when a
   * non-zero exit is a legitimate answer.
   */
  read: (cmd: string) => Promise<string>
  /**
   * Runs `check`, and in `apply` runs `fix` when the check fails, then checks again. In `plan` the fix never runs.
   *
   * A failing fix, or a check that still fails after it, fails the host and throws.
   */
  step: (name: string, options: StepOptions) => Promise<StepResult>
}

export interface StepOptions {
  /**
   * A command where exit 0 means already right, or a function that returns true when already right. It also runs during
   * `plan`, so it must not change anything.
   */
  check: string | (() => Promise<boolean>)
  fix: string
}

export interface StepResult {
  /** True when the step changed something, or would in `plan`, so a follow-up guarded by it shows up in the plan too. */
  changed: boolean
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
