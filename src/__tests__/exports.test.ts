import { describe, expect, it, setDefaultTimeout } from "bun:test"
import path from "node:path"
import process from "node:process"

import { Glob } from "bun"

import { createProject } from "#__tests__/cli-project.ts"

setDefaultTimeout(30_000)

const SRC = path.resolve(import.meta.dir, "..")

// List what each export path holds, so adding an integration without a row here fails.
const PATH_EXPORTS: Record<string, string[]> = {
  "./integrations/macos/file-handlers": ["fileHandlers", "readInfoPlist", "readKnownExtensions"],
}

const PRINT_EXPORTS = "console.log(Object.keys(await import(process.argv[1])).sort().join(','))"

describe("the export paths", () => {
  it("should list every integration here, by the index.ts that is its export path", async () => {
    const indexFiles = await Array.fromAsync(new Glob("integrations/**/index.ts").scan(SRC))
    const exportPaths = indexFiles.map((indexFile) => `./${path.dirname(indexFile)}`)

    const listedIntegrations = Object.keys(PATH_EXPORTS).filter((exportPath) =>
      exportPath.startsWith("./integrations/"),
    )

    expect(exportPaths.toSorted()).toStrictEqual(listedIntegrations.toSorted())
  })

  it("should import each export path from the packed tsinfra", async () => {
    const { run } = await createProject()
    const exportedNames = await Promise.all(
      Object.keys(PATH_EXPORTS).map(async (exportPath) => {
        const specifier = `tsinfra/${exportPath.slice("./".length)}`
        const { stdout } = await run`bun -e ${PRINT_EXPORTS} ${specifier}`
        return [exportPath, stdout.split(",")] as const
      }),
    )

    expect(Object.fromEntries(exportedNames)).toStrictEqual(PATH_EXPORTS)
  })

  // Run a script from the built package, because tsdown's output is what reaches `osascript`.
  it.skipIf(process.platform !== "darwin")("should run a JXA script from the packed tsinfra", async () => {
    const { run } = await createProject()

    const { stdout, exitCode } = await run`tsinfra plan --hosts-dir hosts-integrations --verbose`.nothrow()

    expect(exitCode).toBe(0)
    expect(stdout).toBe(
      [
        "known-extensions",
        `  · observed: (read) osascript -l JavaScript -e "$SCRIPT"`,
        "  - info: known: pdf",
        "",
        "known-extensions   unchanged",
      ].join("\n"),
    )
  })
})
