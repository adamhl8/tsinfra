import { host } from "#core/hosts/host.ts"

// Write root-only files, which need the sudo password the run prompts for.
export default host({ name: "prompted", target: "@local", sudo: true }, async (h) => {
  await h.file("/etc/tsinfra-docker-prompt.conf", "a\n", { sudo: true })

  const { sudoPassword } = h.meta
  if (sudoPassword === undefined) throw new Error("the script got no sudo password from the prompt")
  // Call `command sudo` to skip the `sudo` function, like a program that runs sudo itself.
  await h.run(
    "Write a root-only file with the password from h.meta",
    String.raw`printf '%s\n' "$SUDO_PASSWORD" | command sudo -k -S -p '' touch /etc/tsinfra-docker-prompt-meta.conf`,
    { after: "always", secretEnv: { SUDO_PASSWORD: sudoPassword } },
  )
})
