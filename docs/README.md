# tsinfra design

Working design notes. Nothing here is implemented yet.

tsinfra is a small TypeScript library and CLI for keeping machines configured. You write one script per host. It reads
top to bottom and is made of idempotent steps. tsinfra runs each step's check, shows what has drifted, and runs a fix
only where one is needed.

An earlier design aimed at a full configuration management tool, with a typed inventory and a planning engine. This
design replaces it with something one person can build and maintain.

<!-- toc -->

- [Why](#why)
- [Goals](#goals)
- [Non-goals](#non-goals)
- [Anti-goals](#anti-goals)
- [Example](#example)
- [Concepts](#concepts)
- [Contents](#contents)
- [Runtime](#runtime)

<!-- tocstop -->

## Why

Two earlier approaches each missed something.

**Idempotent bash, then Bun shell scripts.** These mostly worked. But nothing enforced idempotence, every run applied
everything, and there was no way to see what had drifted before touching a machine. Ordering lived in your head: knowing
what had to run first meant reading through everything.

**pyinfra.** It gave a plan mode and diffs, but it is Python. Most of the real work ended up in a hand-rolled `converge`
helper anyway (`~/homelab/pyinfra/lib/operations/converge.py`), which is a check, a fix, and an optional diff.

tsinfra keeps the script shape and adds what scripts lacked:

- A plan mode that runs every check and no fix.
- A diff wherever a step can show one.
- A re-check after each fix, so a fix that does not work fails loudly.
- Requirements, so a step written before the thing it needs gets caught.
- One command that checks every host at once.

## Goals

- **Scripts read like scripts.** Ordinary TypeScript, top to bottom, with ordinary control flow.
- **Your code runs on the control machine.** `fs`, `fetch`, decryption, and string building all happen locally. Only
  shell commands and file bytes reach a target.
- **Nothing on targets** beyond `sh` and `sshd`.
- **`plan` is honest.** It shows what each check sees right now, and marks the places where an earlier change matters.
- **Small.** Buildable in a few weeks and maintainable alone.

## Non-goals

- An inventory file, tags, or groups. A folder of host files is the inventory.
- A dependency graph or any reordering. The order you wrote is the order things run.
- Ordering between hosts. Run them as separate commands.
- A state file.
- A template engine. Template literals cover it.
- A library of built-in operations (apt, brew, systemd). Write helper functions. Some may move into tsinfra later.
- A facts system. `h.read` returns a command's output.
- Secret source adapters. Decrypt in your script and mark the file `secret`.

## Anti-goals

These would make it a failure even if it works:

- **Growing back into the earlier design.** A feature that adds a concept the user has to learn needs a real case
  first.
- **A plan that looks complete but is not.** Where `plan` cannot know, it says so.
- **Ceremony in scripts.** An `isErr` after every step, or registering steps before running them.

## Example

Host files live in the repo that uses tsinfra (`~/homelab`), not in tsinfra itself.

```ts
// hosts/sonarr.ts
import { readFile } from "node:fs/promises"

import { host } from "tsinfra"

import { base } from "../lib/base.ts"
import { dotnet } from "../lib/needs.ts"

export default host("sonarr.lan", async (h) => {
  await base(h)

  await h.ensure("Install Sonarr", {
    requires: [dotnet],
    check: "test -x ~/Sonarr/Sonarr",
    fix: async ({ exec }) => {
      await exec(
        "curl -fsSLo sonarr.tar.gz 'https://services.sonarr.tv/v1/download/main/latest?version=4&os=linux&arch=x64'",
      )
      await exec("tar -xzf sonarr.tar.gz")
      await exec("rm sonarr.tar.gz")
    },
  })

  const unit = await h.file("/etc/systemd/system/sonarr.service", {
    content: await readFile(new URL("../files/sonarr.service", import.meta.url), "utf8"),
    sudo: true,
  })
  await h.run("Reload systemd", "sudo systemctl daemon-reload", { when: unit.changed })

  await h.ensureValue("Start Sonarr", {
    read: "systemctl is-active sonarr",
    want: "active",
    fix: "sudo systemctl enable --now sonarr",
  })
})
```

```sh
tsinfra plan sonarr
tsinfra apply sonarr
tsinfra plan            # every host
```

## Concepts

|                 |                                                                                         |
| --------------- | --------------------------------------------------------------------------------------- |
| **Host**        | A file in `hosts/` that exports `host(target, fn)`. The file name is what the CLI uses. |
| **Step**        | One call on `h`, like `h.ensure` or `h.read`. Steps run one at a time.                  |
| **Requirement** | A named check, like "docker is installed", that steps can require or provide.           |
| **Plan**        | Run every check, no fix. Show what would change.                                        |
| **Apply**       | Run every check, and the fix wherever the check fails.                                  |

## Contents

- **[Steps](./steps.md)**: `ensure`, `ensureValue`, `file`, `run`, `read`, verification, and what happens on failure
- **[Requirements](./requirements.md)**: `need`, `requires`, `provides`, and how order is checked
- **[Transport](./transport.md)**: local and SSH, ControlMaster, sudo, and how commands and files cross
- **[CLI](./cli.md)**: the `hosts/` folder, `plan` and `apply`, output, and exit codes
- **[Open questions](./open-questions.md)**: what still needs an answer

## Runtime

tsinfra runs on Bun and requires it. The library uses Bun APIs, including Bun Shell, and may ship Bun Shell helpers
for host scripts. Host scripts can use Bun APIs too.

The CLI loads `hosts/*.ts` with a dynamic import, which Bun runs as TypeScript directly. Host files import `"tsinfra"`,
so tsinfra has to be installed in the repo that uses it (a dev dependency run with `bunx`). A global install would not
resolve that import.
