import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Arch, FactResult, Platform } from "#core/hosts/prepare/host-details/facts.ts"
import { toNamedFact } from "#core/hosts/prepare/host-details/facts/names.ts"
import type { Shell } from "#core/transport/shell.ts"

// Key each fact's names by what `uname` prints, like `Darwin` for `uname -s`, and map each to tsinfra's name.
const PLATFORM_NAMES: Record<string, Platform> = { Darwin: "darwin", Linux: "linux" }

// Map both arm spellings, because Linux says `aarch64` and macOS says `arm64`. FreeBSD says `amd64`.
// Leave out `aarch64_be` and `armv8l`, because Go's `arm64` builds don't run on big-endian ARM or a 32-bit system.
const ARCH_NAMES: Record<string, Arch> = { x86_64: "amd64", amd64: "amd64", aarch64: "arm64", arm64: "arm64" }

/** Runs `uname` with `option`, and returns what it printed, failing with `factWords` in the message. */
const readUname = async (hostShell: Shell, option: "-s" | "-m", factWords: string): Promise<Result<string>> => {
  const output = await hostShell.exec(`uname ${option}`)
  if (isErr(output)) return err(`failed to read the host's ${factWords}`, output)

  return output.trim()
}

/** Reads the host's platform from `uname -s`, with a warning when tsinfra has no name for it. */
export const readPlatform = async (hostShell: Shell): Promise<Result<FactResult<Platform>>> => {
  const kernel = await readUname(hostShell, "-s", "platform")
  if (isErr(kernel)) return kernel

  return toNamedFact("platform", PLATFORM_NAMES, kernel)
}

/** Reads the host's CPU architecture from `uname -m`, with a warning when tsinfra has no name for it. */
export const readArch = async (hostShell: Shell): Promise<Result<FactResult<Arch>>> => {
  const machine = await readUname(hostShell, "-m", "CPU architecture")
  if (isErr(machine)) return machine

  return toNamedFact("arch", ARCH_NAMES, machine)
}
