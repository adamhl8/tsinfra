import { knipConfig } from "@adamhl8/configs"

const config = knipConfig({
  // Name these as entries, because they run by path from `bask.ts` and `setup.sh`, so nothing imports them.
  entry: ["report-preview.ts", "src/**/*.docker.ts"],
  // Ignore the hidden-input reader until the sudo prompt imports it, which is the next step of `file` part 6.
  ignore: ["src/session/host-context/read-hidden-line.ts"],
})

export default config
