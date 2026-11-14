import { host } from "tsinfra"

export default host("@local", async (h) => {
  await h.read("true")
  await h.ensure("Install git", { want: true, check: "true", fix: "true" })
})
