import { host } from "tsinfra"

export default host({ name: "a", target: "@local" }, async (h) => {
  await h.read("true")
  await h.ensure("Install git", { want: true, check: "true", fix: "true" })
})
