import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { FactContext } from "#core/hosts/prepare/host-details/facts.ts"

declare const HOME_DIRECTORY_BRAND: unique symbol
/** The SSH user's home directory, which is absolute. Only `validateHome` makes one, so a raw `$HOME` can't stand in. */
export type HomeDirectory = string & { readonly [HOME_DIRECTORY_BRAND]: true }

// Read `$HOME` with `printf '%s'`, because it prints the value exactly, with no newline to strip.
// `echo` treats backslashes or a leading `-n` specially in some shells.
const READ_HOME_COMMAND = `printf '%s' "$HOME"`

/** Checks the `$HOME` the host printed, because a path built from an empty or relative home lands in the wrong place. */
export const validateHome = (rawHome: string): Result<HomeDirectory> => {
  if (rawHome === "") return err("$HOME isn't set on the host", undefined)
  if (!rawHome.startsWith("/")) return err(`$HOME on the host is '${rawHome}', not an absolute path`, undefined)

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion - a brand exists only in the types, so only `as` can make one
  return rawHome as HomeDirectory
}

/**
 * Reads the SSH user's home, which a path that starts with `~/` needs. An unset `$HOME` comes back empty, so the read
 * fails only when the host can't run commands at all.
 */
export const readHome = async (ctx: FactContext): Promise<Result<HomeDirectory>> => {
  const homeOutput = await ctx.shell.exec(READ_HOME_COMMAND, { label: "home directory" })
  if (isErr(homeOutput)) return err("failed to read the SSH user's home directory", homeOutput)

  return validateHome(homeOutput)
}
