import { entries } from "remeda"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { HomeDirectory } from "#core/hosts/prepare/host-details/facts/home.ts"
import { readHome } from "#core/hosts/prepare/host-details/facts/home.ts"
import { readOsRelease } from "#core/hosts/prepare/host-details/facts/os-release.ts"
import { readArch, readPlatform } from "#core/hosts/prepare/host-details/facts/system.ts"
import type { HostWarningRecord } from "#core/session/recorder/records.ts"
import type { Shell } from "#core/transport/shell.ts"

/** What tsinfra reads from the host before its script runs, which nothing in a run would change. It's frozen. */
export interface HostFacts {
  /** The SSH user's home directory, like `/home/alice`, even in a step with `sudo`. It's always absolute. */
  readonly home: HomeDirectory
  /** The host's platform, by Go's `GOOS` name, which most release downloads use. */
  readonly platform: Platform
  /** The host's CPU architecture, by Go's `GOARCH` name, which most release downloads, Docker, and apt use. */
  readonly arch: Arch
  /** What the host's `os-release` file says about its distribution, or undefined when it has none, like macOS. */
  readonly osRelease: OsRelease | undefined
}

/**
 * A host's platform. A platform tsinfra has no name for is what `uname -s` printed, and the report warns about it, so
 * the type can be wrong.
 */
export type Platform = "darwin" | "linux"

/**
 * A host's CPU architecture. One tsinfra has no name for is what `uname -m` printed, and the report warns about it, so
 * the type can be wrong.
 */
export type Arch = "amd64" | "arm64"

/** What a Linux host's `os-release` file says about its distribution. */
export interface OsRelease {
  /** `ID`, like `debian` or `ubuntu`. */
  readonly id: string
  /** `ID_LIKE`, the distributions it's close to, like `["debian"]` for Ubuntu. */
  readonly idLike: readonly string[]
  /** `VERSION_ID`, like `13`, or undefined on a rolling distribution. */
  readonly versionId: string | undefined
  /** `VERSION_CODENAME`, like `trixie`, or undefined when the distribution has none. */
  readonly versionCodename: string | undefined
  /** `PRETTY_NAME`, like `Debian GNU/Linux 13 (trixie)`. */
  readonly prettyName: string | undefined
}

/** The facts tsinfra gives its own names, so a value it has no name for gets a warning. */
export type NamedFact = "platform" | "arch"

/** Every fact, and a warning for each value tsinfra has no name for. */
interface ReadHostFacts {
  facts: HostFacts
  warnings: HostWarningRecord[]
}

/** A fact's value, and a warning about it when there is one. */
export interface FactResult<T> {
  value: T
  warning: HostWarningRecord | undefined
}

/** Reads one fact from the host, with a warning when there is one. Fails when the host can't give it. */
type FactReader<T> = (hostShell: Shell) => Promise<Result<FactResult<T>>>

// Give each fact the reader that reads it from the host, in the order of `HostFacts`.
const FACT_READERS: { [F in keyof HostFacts]: FactReader<HostFacts[F]> } = {
  home: readHome,
  platform: readPlatform,
  arch: readArch,
  osRelease: readOsRelease,
}

/** Reads every fact, and a warning for each value tsinfra has no name for. */
export const readHostFacts = async (hostShell: Shell): Promise<Result<ReadHostFacts>> => {
  const facts: Partial<Record<keyof HostFacts, unknown>> = {}
  const warnings: HostWarningRecord[] = []

  for (const [fact, readFact] of entries(FACT_READERS)) {
    // oxlint-disable-next-line no-await-in-loop - read one fact at a time, so preparation records its commands in order
    const factResult = await readFact(hostShell)
    if (isErr(factResult)) return factResult

    facts[fact] = factResult.value
    if (factResult.warning) warnings.push(factResult.warning)
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion - the loop sets every key of `HostFacts`, which TypeScript can't follow
  return { facts: Object.freeze(facts) as HostFacts, warnings }
}
