/** What a run does: `plan` compares each host with its script, and `apply` changes it to match. */
export const MODES = ["plan", "apply"] as const
export type Mode = (typeof MODES)[number]
