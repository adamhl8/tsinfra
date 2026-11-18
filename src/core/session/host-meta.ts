/** What a host's function is given about the host besides its steps, known before the script runs. */
export interface HostMeta {
  /** The host script's name, like `"sonarr"`. */
  readonly name: string
  /**
   * The password tsinfra gives the host's sudo, from `host()` or the prompt, for a program that runs sudo itself. It's
   * undefined when the host has no password. Pass it to a command through `secretEnv`. `console.log(h.meta)` shows it
   * as `[Getter]`, and spreads and `JSON.stringify` leave it out.
   */
  readonly sudoPassword: string | undefined
}

/** Returns a frozen `HostMeta` whose `sudoPassword` stays out of logs, spreads, and JSON. */
export const createHostMeta = (name: string, sudoPassword: string | undefined): HostMeta => {
  // Make `sudoPassword` a getter because Bun's `console.log` prints a getter as `[Getter]` and never calls it.
  // Make it non-enumerable because a spread or `JSON.stringify` still calls an enumerable getter.
  const meta: HostMeta = {
    name,
    get sudoPassword() {
      return sudoPassword
    },
  }
  Object.defineProperty(meta, "sudoPassword", { enumerable: false })
  return Object.freeze(meta)
}
