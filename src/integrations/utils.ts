import type { Platform } from "#core/hosts/prepare/host-details/facts.ts"
import type { Host } from "#core/session.ts"

/** Throws when the host isn't on `wantedPlatform`, naming the integration, so a script stops before its first step. */
export const assertPlatform = (h: Host, wantedPlatform: Platform, integrationName: string) => {
  const currentPlatform = h.facts.platform
  if (currentPlatform !== wantedPlatform) {
    throw new Error(
      `The '${integrationName}' integration needs a '${wantedPlatform}' host, but this host is '${currentPlatform}'`,
    )
  }
}
