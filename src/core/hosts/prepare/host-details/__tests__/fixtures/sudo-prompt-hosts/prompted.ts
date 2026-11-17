import { host } from "#core/hosts/host.ts"

// Write a root-only file, which needs the sudo password the run prompts for.
export default host({ name: "prompted", target: "@local", sudo: true }, async (h) => {
  await h.file("/etc/tsinfra-docker-prompt.conf", "a\n", { sudo: true })
})
