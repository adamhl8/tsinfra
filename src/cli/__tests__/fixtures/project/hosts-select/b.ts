import { host } from "tsinfra"

// Fail if this host runs, because the test names only `a`.
export default host("@local", async (h) => {
  await h.read("exit 1")
})
