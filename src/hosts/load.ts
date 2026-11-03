import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { attempt, err, filterMap, isErr, messageChain } from "ts-explicit-errors"

import type { HostScript } from "#hosts/discover.ts"
import type { HostDefinition } from "#hosts/host.ts"
import { hostDefinitionSchema } from "#hosts/host.ts"

export interface LoadedHost extends HostDefinition {
  name: string
}

const hostModuleSchema = type({ default: hostDefinitionSchema })

const loadHost = async (hostScript: HostScript): Promise<Result<LoadedHost>> => {
  const { name, file } = hostScript
  const hostModule = await attempt(async (): Promise<unknown> => import(file))
  if (isErr(hostModule)) return err(`failed to load host '${name}'`, hostModule)

  const validModule = hostModuleSchema(hostModule)
  if (validModule instanceof type.errors)
    return err(`failed to load host '${name}'`, err(validModule.summary, undefined))

  return { name, ...validModule.default }
}

/** Imports each host script and returns its entry, or an error that lists every file that failed. */
export const loadHosts = async (hostScripts: HostScript[]): Promise<Result<LoadedHost[]>> => {
  const { values: loadedHosts, errors } = await filterMap(hostScripts, loadHost)
  if (errors) return err(`failed to load hosts:\n${errors.map((error) => messageChain(error)).join("\n")}`, undefined)

  return loadedHosts
}
