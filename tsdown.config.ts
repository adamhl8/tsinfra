import { tsdownConfig } from "@adamhl8/configs"
import { defineConfig } from "tsdown"

const config = tsdownConfig({
  platform: "node",
  entry: ["./src/cli.ts", "./src/integrations/**/index.ts"],
  suppressWarnings: ["TypeScript 7.0 does not yet have a stable API"],
})

export default defineConfig(config)
