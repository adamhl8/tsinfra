import { lint } from "@adamhl8/configs/bask"
import { Glob } from "bun"

export * from "@adamhl8/configs/bask"

// Sync the TOCs under `docs/` before `lint` so oxfmt formats them.
// The base task only syncs README.md's TOC.
lint.before(async ({ sh }) => {
  const files = await Array.fromAsync(new Glob("docs/*.md").scan())
  await Promise.all(files.map(async (file) => sh`markdown-toc -i --bullets '-' --maxdepth 3 ${file}`))
})
