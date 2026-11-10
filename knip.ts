import { knipConfig } from "@adamhl8/configs"

const config = knipConfig({
  // Name these as entries, because they run by path from `bask.ts` and `setup.sh`, so nothing imports them.
  entry: ["report-preview.ts", "src/**/*.docker.ts"],
  // List the system tools the Docker tests run, because `setup.sh` installs them, so no package provides them.
  ignoreBinaries: ["ssh-keygen"],
})

export default config
