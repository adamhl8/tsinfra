import { entries } from "remeda"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { HomeDirectory } from "#core/hosts/prepare/host-details/facts/home.ts"
import { readHome } from "#core/hosts/prepare/host-details/facts/home.ts"
import { readOsRelease } from "#core/hosts/prepare/host-details/facts/os-release.ts"
import { readArch, readPlatform } from "#core/hosts/prepare/host-details/facts/system.ts"
import type { HostWarningRecorder } from "#core/recorder/preparation-recorder.ts"
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

/** What a fact's reader is given: the shell to read the host with, and what to record a warning through. */
export interface FactContext {
  shell: Shell
  recorder: HostWarningRecorder
}

/** Reads one fact from the host, and records a warning when it finds one. Fails when the host can't give it. */
type FactReader<T> = (ctx: FactContext) => Promise<Result<T>>

// Give each fact the reader that reads it from the host, in the order of `HostFacts`.
const FACT_READERS: { [F in keyof HostFacts]: FactReader<HostFacts[F]> } = {
  home: readHome,
  platform: readPlatform,
  arch: readArch,
  osRelease: readOsRelease,
}

/** Reads every fact, and records a warning for each value tsinfra has no name for. */
export const readHostFacts = async (ctx: FactContext): Promise<Result<HostFacts>> => {
  const facts: Partial<Record<keyof HostFacts, unknown>> = {}

  for (const [fact, readFact] of entries(FACT_READERS)) {
    // oxlint-disable-next-line no-await-in-loop - read one fact at a time, so preparation records its commands in order
    const value = await readFact(ctx)
    if (isErr(value)) return value

    facts[fact] = value
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion - the loop sets every key of `HostFacts`, which TypeScript can't follow
  return Object.freeze(facts) as HostFacts
}
