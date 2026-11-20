import { knipConfig } from "@adamhl8/configs"

const config = knipConfig({
  // Name these as entries, because they run by path from `bask.ts` and `setup.sh`, so nothing imports them.
  entry: ["report-preview.ts", "src/**/*.docker.ts"],
})

export default config
