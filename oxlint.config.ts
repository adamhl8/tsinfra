import { oxlintConfig } from "@adamhl8/configs"
import { defineConfig } from "oxlint"

const config = oxlintConfig({
  overrides: [
    {
      // Turn this off here, because the rule reports at the file's first character, before a comment can suppress it.
      // The declaration has to be a script, because `declare module` in a module fails.
      files: ["src/cli/__tests__/fixtures/tsinfra.d.ts"],
      rules: { "import/unambiguous": "off" },
    },
  ],
})

export default defineConfig(config)
