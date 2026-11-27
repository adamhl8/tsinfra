import path from "node:path"

import { regex } from "arkregex"
import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { HomeDirectory } from "#core/hosts/prepare/host-details/facts/home.ts"
import type { InputDescription } from "#core/session/handlers/shared/validate-input.ts"
import { validateInput } from "#core/session/handlers/shared/validate-input.ts"

// Refuse a relative path, because it would land wherever the shell starts. This also refuses `~user/`.
const hostPathSchema = type(regex("^(?:/|~(?:/|$))", "v")).describe("an absolute path, starting with / or ~/")

// Refuse a `..` segment, because the host resolves it through symlinks, and `resolvePath` resolves it as text.
const noParentSegmentSchema = type("string").narrow(
  (writtenPath, ctx) => !writtenPath.split("/").includes("..") || ctx.mustBe("a path without a '..' segment"),
)

/**
 * Replaces a leading `~/` or a bare `~` in `writtenPath` with `home`, the SSH user's home directory, then normalizes it
 * without a trailing `/`.
 *
 * It takes any string, because a step's name is claimed before its path is validated.
 */
export const resolvePath = (writtenPath: string, home: HomeDirectory): string => {
  const isHomePath = writtenPath === "~" || writtenPath.startsWith("~/")
  const homeResolvedPath = isHomePath ? `${home}${writtenPath.slice(1)}` : writtenPath

  const normalizedPath = path.posix.normalize(homeResolvedPath)
  const hasTrailingSlash = normalizedPath.length > 1 && normalizedPath.endsWith("/")
  return hasTrailingSlash ? normalizedPath.slice(0, -1) : normalizedPath
}

/** Validates a path the script gave a step, and resolves it with `resolvePath`. */
export const validateHostPath = (
  writtenPath: unknown,
  home: HomeDirectory,
  description: InputDescription,
): Result<string> => {
  const { inputLabel, givenTo } = description

  const validPath = validateInput(writtenPath, hostPathSchema, description)
  if (isErr(validPath)) return validPath

  // Leave out `reason`, because it describes a relative path.
  const validSegmentsPath = validateInput(validPath, noParentSegmentSchema, { inputLabel, givenTo })
  if (isErr(validSegmentsPath)) return validSegmentsPath

  return resolvePath(validSegmentsPath, home)
}
