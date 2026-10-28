import { tsdownConfig } from "@adamhl8/configs"
import { defineConfig } from "tsdown"

const config = tsdownConfig({ platform: "node", entry: ["./src/cli/cli.ts"] })

export default defineConfig(config)
