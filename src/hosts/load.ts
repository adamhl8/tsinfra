import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { attempt, err, filterMap, isErr, messageChain } from "ts-explicit-errors"

import type { HostFile } from "#hosts/discover.ts"
import type { HostDefinition } from "#hosts/host.ts"
import { hostDefinitionSchema } from "#hosts/host.ts"

export interface HostEntry extends HostDefinition {
  name: string
}

const hostModuleSchema = type({ default: hostDefinitionSchema })

const loadHost = async ({ name, file }: HostFile): Promise<Result<HostEntry>> => {
  const hostModule = await attempt(async (): Promise<unknown> => import(file))
  if (isErr(hostModule)) return err(`failed to load host '${name}'`, hostModule)

  const validModule = hostModuleSchema(hostModule)
  if (validModule instanceof type.errors)
    return err(`failed to load host '${name}'`, err(validModule.summary, undefined))

  return { name, ...validModule.default }
}

/** Imports each host file and returns its entry, or an error that lists every file that failed. */
export const loadHosts = async (hostFiles: HostFile[]): Promise<Result<HostEntry[]>> => {
  const { values: hostEntries, errors } = await filterMap(hostFiles, loadHost)
  if (errors) return err(`failed to load hosts:\n${errors.map((error) => messageChain(error)).join("\n")}`, undefined)

  return hostEntries
}
