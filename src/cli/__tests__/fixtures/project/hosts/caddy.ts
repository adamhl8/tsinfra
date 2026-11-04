import { host } from "tsinfra"

export default host("@local", async (h) => {
  await h.read("true")
})
