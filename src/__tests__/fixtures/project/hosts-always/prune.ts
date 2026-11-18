import { host } from "tsinfra"

export default host({ name: "prune", target: "@local" }, async (h) => {
  await h.run("Prune docker", "true", { after: "always" })
})
