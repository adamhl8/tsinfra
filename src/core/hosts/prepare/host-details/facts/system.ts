import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Arch, FactContext, Platform } from "#core/hosts/prepare/host-details/facts.ts"
import { toNamedFact } from "#core/hosts/prepare/host-details/facts/names.ts"

// Key each fact's names by what `uname` prints, like `Darwin` for `uname -s`, and map each to tsinfra's name.
const PLATFORM_NAMES: Record<string, Platform> = { Darwin: "darwin", Linux: "linux" }

// Map both arm spellings, because Linux says `aarch64` and macOS says `arm64`. FreeBSD says `amd64`.
// Leave out `aarch64_be` and `armv8l`, because Go's `arm64` builds don't run on big-endian ARM or a 32-bit system.
const ARCH_NAMES: Record<string, Arch> = { x86_64: "amd64", amd64: "amd64", aarch64: "arm64", arm64: "arm64" }

/** Runs `uname` with `option`, and returns what it printed, failing with `factWords` in the message. */
const readUname = async (ctx: FactContext, option: "-s" | "-m", factWords: string): Promise<Result<string>> => {
  const output = await ctx.shell.exec(`uname ${option}`)
  if (isErr(output)) return err(`failed to read the host's ${factWords}`, output)

  return output.trim()
}

/** Reads the host's platform from `uname -s`, and records a warning when tsinfra has no name for it. */
export const readPlatform = async (ctx: FactContext): Promise<Result<Platform>> => {
  const kernel = await readUname(ctx, "-s", "platform")
  if (isErr(kernel)) return kernel

  return toNamedFact(ctx, "platform", PLATFORM_NAMES, kernel)
}

/** Reads the host's CPU architecture from `uname -m`, and records a warning when tsinfra has no name for it. */
export const readArch = async (ctx: FactContext): Promise<Result<Arch>> => {
  const machine = await readUname(ctx, "-m", "CPU architecture")
  if (isErr(machine)) return machine

  return toNamedFact(ctx, "arch", ARCH_NAMES, machine)
}
