import { host } from "tsinfra"

// Start the sleep in a shell of its own, so `$$` is the sleep's pid once `exec` replaces the shell.
export default host({ name: "interrupt", target: "@local" }, async (h) => {
  await h.run("Sleep", `sh -c 'echo $$ > "$PID_FILE"; exec sleep 30'`, { after: "always" })
})
