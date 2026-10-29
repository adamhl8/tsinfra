import type { Result } from "ts-explicit-errors"
import { attempt, err, filterMap, isErr, messageChain } from "ts-explicit-errors"

import type { HostFile } from "#hosts/discover.ts"
import type { HostDefinition } from "#hosts/host.ts"
import { isHostDefinition } from "#hosts/host.ts"

export interface LoadedHost extends HostFile, HostDefinition {}

const hasHostDefault = (hostModule: unknown): hostModule is { default: HostDefinition } =>
  typeof hostModule === "object"
  && hostModule !== null
  && "default" in hostModule
  && isHostDefinition(hostModule.default)

const loadHost = async ({ name, file }: HostFile): Promise<Result<LoadedHost>> => {
  const hostModule = await attempt(async (): Promise<unknown> => import(file))
  if (isErr(hostModule)) return err(`failed to load host '${name}'`, hostModule)
  if (!hasHostDefault(hostModule)) return err(`host '${name}' does not default export host()`, undefined)

  return { name, file, ...hostModule.default }
}

/** Imports each host file and returns its host, or an error that lists every file that failed. */
export const loadHosts = async (hostFiles: HostFile[]): Promise<Result<LoadedHost[]>> => {
  const { values: hosts, errors } = await filterMap(hostFiles, loadHost)
  if (errors) return err(`failed to load hosts:\n${errors.map((error) => messageChain(error)).join("\n")}`, undefined)

  return hosts
}
