import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import { createHostContext } from "#hosts/context.ts"
import type { LoadedHost } from "#hosts/load.ts"

export const runHost = async (host: LoadedHost): Promise<Result> => {
  const { h, getFailure } = createHostContext(host)
  const fnResult = await attempt(async () => host.fn(h))

  // Report the failure recorded on `h` first, because a script that catches it can go on to throw something else.
  const failure = getFailure()
  if (failure) return err(`failed to run host '${host.name}'`, failure)
  if (isErr(fnResult)) return err(`failed to run host '${host.name}'`, fnResult)
}
