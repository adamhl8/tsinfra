import path from "node:path"
import process from "node:process"

import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { attempt, err, filterMap, isErr, messageChain } from "ts-explicit-errors"

import type { HostFunction, ValidHostDefinition, ValidHostOptions } from "#hosts/host.ts"
import { hostDefinitionSchema } from "#hosts/host.ts"
import { quoteNames } from "#utils.ts"

/** A host once its script is loaded and its definition is validated. */
export interface LoadedHost {
  name: string
  target: string
  options: ValidHostOptions
  fn: HostFunction
}

/** A loaded host and the host script that defined it, which the error for a repeated name names. */
interface LoadedHostScript {
  file: string
  loadedHost: LoadedHost
}

const hostModuleSchema = type({ default: hostDefinitionSchema })

/** Returns `file` relative to the working directory, which is how the user wrote the hosts directory. */
const toDisplayedFile = (file: string): string => path.relative(process.cwd(), file)

/** Flattens a validated host definition into the host the rest of the run uses. */
export const toLoadedHost = (validHostDefinition: ValidHostDefinition): LoadedHost => {
  const { config, fn } = validHostDefinition
  const { name, target, ...options } = config
  return { name, target, options, fn }
}

const loadHostScript = async (file: string): Promise<Result<LoadedHostScript>> => {
  const displayedFile = toDisplayedFile(file)

  const hostModule = await attempt(async (): Promise<unknown> => import(file))
  if (isErr(hostModule)) return err(`failed to load '${displayedFile}'`, hostModule)

  const validModule = hostModuleSchema(hostModule)
  if (validModule instanceof type.errors)
    return err(`failed to load '${displayedFile}'`, err(validModule.summary, undefined))

  return { file, loadedHost: toLoadedHost(validModule.default) }
}

/** Returns an error for each name more than one host script defines, naming every script that defines it. */
const findRepeatedNames = (loadedHostScripts: LoadedHostScript[]): Error[] => {
  const filesByName = Map.groupBy(loadedHostScripts, ({ loadedHost }) => loadedHost.name)
  return [...filesByName]
    .filter(([, scripts]) => scripts.length > 1)
    .map(([name, scripts]) =>
      err(
        `more than one host script defines the host '${name}': ${quoteNames(scripts.map(({ file }) => toDisplayedFile(file)))}`,
        undefined,
      ),
    )
}

/**
 * Imports each host script and returns its loaded host, in the scripts' order. Fails with every script that failed to
 * load, or with every host name more than one script defines, because a host's saved state is kept by its name.
 */
export const loadHosts = async (files: string[]): Promise<Result<LoadedHost[]>> => {
  const { values: loadedHostScripts, errors } = await filterMap(files, loadHostScript)
  const loadErrors = [...(errors ?? []), ...findRepeatedNames(loadedHostScripts)]
  if (loadErrors.length > 0)
    return err(`failed to load hosts:\n${loadErrors.map((error) => messageChain(error)).join("\n")}`, undefined)

  return loadedHostScripts.map(({ loadedHost }) => loadedHost)
}

/** Returns the hosts named in `names`, in their scripts' order, or every host when `names` is empty. */
export const selectHosts = (loadedHosts: LoadedHost[], names: readonly string[]): Result<LoadedHost[]> => {
  if (names.length === 0) return loadedHosts

  const hostNames = new Set(loadedHosts.map(({ name }) => name))
  const unknownNames = names.filter((name) => !hostNames.has(name))
  if (unknownNames.length > 0)
    return err(`unknown host ${quoteNames(unknownNames)} (hosts: ${quoteNames(hostNames)})`, undefined)

  const selectedNames = new Set(names)
  return loadedHosts.filter(({ name }) => selectedNames.has(name))
}
