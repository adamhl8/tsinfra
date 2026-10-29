import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { LoadedHost } from "#hosts/load.ts"

export const runHost = async ({ name, fn }: LoadedHost): Promise<Result> => {
  const fnResult = await attempt(async () => fn())
  if (isErr(fnResult)) return err(`failed to run host '${name}'`, fnResult)
}
