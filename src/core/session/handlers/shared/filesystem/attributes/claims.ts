import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { FileAttributeOptions, FileOwner } from "#core/session/handlers/options/attributes.ts"
import { parseFileMode, toOctalMode } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import type { StepContext, StepKind } from "#core/session/step.ts"

/** A step's claim on one attribute of a path: the value it sets, like a file's mode or a link target's user. */
export interface PathAttributeClaim {
  stepName: string
  kind: StepKind
  name: keyof FileAttributeOptions
  /** A mode as octal text, so two ways of writing one mode are equal. A user or group as given. */
  value: FileOwner
}

/** Lists the step's claims, one for each attribute `options` sets. */
const toPathAttributeClaims = (ctx: StepContext, options: FileAttributeOptions): PathAttributeClaim[] => {
  const { stepName, kind } = ctx
  const { mode, user, group } = options

  const modeClaims: PathAttributeClaim[] =
    mode === undefined ? [] : [{ stepName, kind, name: "mode", value: toOctalMode(parseFileMode(mode)) }]
  const userClaims: PathAttributeClaim[] = user === undefined ? [] : [{ stepName, kind, name: "user", value: user }]
  const groupClaims: PathAttributeClaim[] = group === undefined ? [] : [{ stepName, kind, name: "group", value: group }]
  return [...modeClaims, ...userClaims, ...groupClaims]
}

/**
 * Fails a step that sets an attribute of `path` that an earlier step set differently, because each apply would undo the
 * other. Records the attributes the step sets otherwise. Compares each attribute on its own, so two steps can set
 * different attributes of one path.
 */
export const claimPathAttributes = (ctx: StepContext, path: string, options: FileAttributeOptions): Result => {
  const { pathAttributeClaims } = ctx

  const earlierClaims = pathAttributeClaims.get(path) ?? []
  const claims = toPathAttributeClaims(ctx, options)

  for (const { name, value } of claims) {
    const earlierClaim = earlierClaims.find((claim) => claim.name === name)
    if (earlierClaim === undefined || earlierClaim.value === value) continue

    const { stepName, kind, value: earlierValue } = earlierClaim
    return err(
      `'${path}' already gets ${name} '${String(earlierValue)}' from ${kind} '${stepName}', so it can't get '${String(value)}'`,
      undefined,
    )
  }

  // Keep an earlier claim, so a later conflict names the first step that set the attribute.
  const newClaims = claims.filter(({ name }) => !earlierClaims.some((claim) => claim.name === name))
  pathAttributeClaims.set(path, [...earlierClaims, ...newClaims])
}
