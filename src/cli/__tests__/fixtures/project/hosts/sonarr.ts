import { host } from "tsinfra"

// Read the marker's path from `$MARKER`, because commands run from the home directory.
export default host("@local", async (h) => {
  const marker = await h.ensure("Make marker", { want: true, check: 'test -f "$MARKER"', fix: 'touch "$MARKER"' })
  await h.run("Restart", "true", { after: [marker] })
})
