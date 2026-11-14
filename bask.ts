import { task } from "@adamhl8/bask"
import { lint } from "@adamhl8/configs/bask"
import bun, { Glob } from "bun"

export * from "@adamhl8/configs/bask"

// Sync the TOCs under `docs/` before `lint` so oxfmt formats them.
// The base task only syncs README.md's TOC.
lint.before(async ({ sh }) => {
  const files = await Array.fromAsync(new Glob("docs/*.md").scan())
  await Promise.all(files.map(async (file) => sh`markdown-toc -i --bullets '-' --maxdepth 3 ${file}`))
})

export const reportPreview = task(
  { desc: "Print the report with every element and message tsinfra writes at least once" },
  async ({ sh }) => {
    await sh`bun report-preview.ts`
  },
)

// Use one distro per shell: Alpine for busybox, and Debian for dash.
const DOCKER_DISTROS = ["alpine", "debian"]

// Leave this out of `lint`, because it needs Docker running, and it downloads images and packages.
export const testDocker = task(
  { desc: "Run the tests that need Linux, real root, and real sudo, in Docker" },
  async ({ sh }) => {
    for (const distro of DOCKER_DISTROS) {
      const image = `oven/bun:${bun.version}-${distro}`
      // oxlint-disable-next-line eslint/no-await-in-loop - run one at a time, so each container's output stays together
      await sh`docker run --rm -v ${import.meta.dir}:/repo:ro ${image} sh /repo/src/__tests__/docker/setup.sh ${distro}`
    }
  },
)
