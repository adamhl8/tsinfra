import path from "node:path"

/** Writes an empty host file for each name into `dir`. */
export const writeHosts = async (dir: string, names: string[]) => {
  await Promise.all(names.map(async (name) => Bun.write(path.join(dir, `${name}.ts`), "")))
}
