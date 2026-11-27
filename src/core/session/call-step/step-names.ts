import type { Result } from "ts-explicit-errors"
import { err } from "ts-explicit-errors"

import type { HomeDirectory } from "#core/hosts/prepare/host-details/facts/home.ts"
import { resolvePath } from "#core/session/handlers/shared/filesystem/path.ts"
import type { ChangeStepKind, StepKind } from "#core/session/step.ts"
import { isChangeStepKind, isPathStepKind } from "#core/session/step.ts"

/** Claims `stepName` for a step of `kind`, or fails when an earlier step has it. */
type ClaimStepName = (stepName: string, kind: StepKind) => Result

/** Returns the function that claims each change step's name, and each path step's path, for one host's session. */
export const createStepNameClaims = (home: HomeDirectory): ClaimStepName => {
  const stepKindsByName = new Map<string, ChangeStepKind>()
  const stepKindsByPath = new Map<string, ChangeStepKind>()

  // Refuse a name an earlier change step has, because the report and `needs` tell steps apart by name.
  // Refuse a path an earlier path step has under another spelling, like `~/x` and `/home/user/x`.
  const claimStepName = (stepName: string, kind: StepKind): Result => {
    if (!isChangeStepKind(kind)) return

    const earlierKind = stepKindsByName.get(stepName)
    if (earlierKind) {
      return err(
        `an earlier ${earlierKind} step has the same name, and step names must be unique in a host script`,
        undefined,
      )
    }

    const resolvedPath = isPathStepKind(kind) ? resolvePath(stepName, home) : undefined
    const earlierPathKind = resolvedPath === undefined ? undefined : stepKindsByPath.get(resolvedPath)
    if (earlierPathKind) {
      return err(
        `an earlier ${earlierPathKind} step has the same path, and a path can have only one file, link, or dir step in a host script`,
        undefined,
      )
    }

    stepKindsByName.set(stepName, kind)
    if (resolvedPath !== undefined) stepKindsByPath.set(resolvedPath, kind)
  }

  return claimStepName
}
