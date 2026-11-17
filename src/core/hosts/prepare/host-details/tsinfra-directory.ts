import path from "node:path"

import type { HomeDirectory } from "#core/hosts/prepare/host-details.ts"

// Keep what tsinfra leaves on a host in one directory in the SSH user's home.
// A home works where `/tmp` doesn't, because sudo can't run a helper from a `/tmp` mounted `noexec`.
const TSINFRA_DIRECTORY_NAME = ".tsinfra"

/** Returns where the sudo askpass helper goes on a host. It holds no secret, so it stays there between runs. */
export const toAskpassHelperPath = (home: HomeDirectory): string =>
  path.posix.join(home, TSINFRA_DIRECTORY_NAME, "askpass.sh")

/**
 * Returns where a host's saved state goes on a host. It's named by the host's name, not its target, because two host
 * scripts can manage the same machine, and step names are unique only within one script.
 */
export const toSavedStatePath = (home: HomeDirectory, hostName: string): string =>
  path.posix.join(home, TSINFRA_DIRECTORY_NAME, "state", `${hostName}.json`)
