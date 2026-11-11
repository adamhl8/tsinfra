import type { Mode } from "#mode.ts"
import type { HostBlock } from "#report/host-block.ts"
import { hasDrift, hasFailed } from "#report/summary.ts"

const DRIFT_EXIT_CODE = 2

/**
 * Returns the run's exit code from the hosts' blocks: 1 for a failed host, 2 for drift in `plan`, and 0 otherwise. It
 * uses the summary's checks, so it agrees with what the summary says.
 */
export const getExitCode = (hostBlocks: HostBlock[], mode: Mode): number => {
  // Exit 1 for a failed host even when another has drift, because the plan is incomplete.
  if (hostBlocks.some((hostBlock) => hasFailed(hostBlock))) return 1

  const hasAnyDrift = hostBlocks.some((hostBlock) => hasDrift(hostBlock))
  return mode === "plan" && hasAnyDrift ? DRIFT_EXIT_CODE : 0
}
