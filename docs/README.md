# tsinfra design

Working design notes. They describe tsinfra as it is. What's planned, undecided, or ruled out is in the
[roadmap](./roadmap.md).

tsinfra is a small TypeScript library and CLI for keeping machines configured. You write one script per host. It reads
top to bottom and is made of idempotent steps. tsinfra reads each step's state on the host, shows what has drifted, and runs a fix
only where one is needed.

An earlier design aimed at a full configuration management tool, with a typed inventory and a planning engine. This
design replaces it with something one person can build and maintain.

<!-- toc -->

- [Why](#why)
- [Goals](#goals)
- [Non-goals](#non-goals)
- [Anti-goals](#anti-goals)
- [No record of resources](#no-record-of-resources)
- [Compared with other tools](#compared-with-other-tools)
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

- A plan mode that reads every step's state and runs no fix.
- A diff wherever a step can show one.
- A second read of the state after each fix, so a fix that does not work fails loudly.
- Needs, so `plan` waits on an earlier change instead of reading the host too early.
- One command that checks every host at once.

## Goals

- **Scripts read like scripts.** Ordinary TypeScript, top to bottom, with ordinary control flow.
- **Your code runs on the control machine.** `fs`, `fetch`, decryption, and string building all happen locally. Only
  shell commands and file bytes reach a host.
- **Nothing on hosts** beyond `sh` and `sshd`.
- **`plan` is honest.** It shows what each step sees on the host right now, and marks the places where an earlier change matters.
- **Small.** Buildable in a few weeks and maintainable alone.

## Non-goals

- An inventory file, tags, or groups. A folder of host scripts is the inventory.
- A dependency graph or any reordering of steps. The order you wrote is the order things run.
- Ordering between hosts, for now. Run them as separate commands. A [tentative design](./roadmap.md#ordering-between-hosts) comes late.
- A record of resources, or a state file on the control machine.
- A template engine. Template literals cover it.
- Built-in integrations for tools like apt, brew, and systemd. Write functions that call steps. Some may move into
  tsinfra later (see [the roadmap](./roadmap.md#integrations-worth-shipping)).
- A facts system. `h.read` returns a command's output.
- Secret source adapters. Decrypt in your script, and mark the file `secret` or pass the value in a step's `secretEnv`.

## Anti-goals

These would make it a failure even if it works:

- **Growing back into the earlier design.** A feature that adds a concept the user has to learn needs a real case
  first.
- **A plan that looks complete but is not.** Where `plan` cannot know, it says so.
- **Ceremony in scripts.** An `isErr` after every step, or registering steps before running them.

## No record of resources

tsinfra keeps no record of what it manages. Every `plan` reads the machine as it is now, and any checkout on any control
machine gives the same plan. Ansible and pyinfra work the same way. Terraform needs state because it creates resources
and has to know which ones are its own. tsinfra configures machines that already exist.

The one thing it keeps is a small saved state on each host, which holds the changes an apply that didn't finish made,
so the runs after them still trigger next time (see [Steps](./steps.md#when-an-apply-doesnt-finish)). A trigger is the
only thing that exists in one apply alone, because every other step reads the host's state. A host that finishes cleanly
deletes it, so it never needs locking or syncing between control machines, and it's never a source of truth about what
the host should look like.

What that costs:

- **Removing a step does not undo it.** A file or package the script stops managing stays on the machine. Removing it
  takes a step that removes it, like `want: false` and `check: "test -e /etc/sonarr.conf"`, with
  `fix: "sudo rm /etc/sonarr.conf"`.
- **`plan` cannot say why something differs.** A hand edit on the machine and an edit to the script look the same,
  because there is no record of the last apply.
- **Run-once work needs a marker.** A one-time migration has no natural check, so it leaves a marker on the host, like
  `test -f /var/lib/myapp/migrated`, and checks for that.

If forgotten files become a real problem, a manifest of managed paths in the host's saved state is a lighter fix than a
record of resources (see [Removed resources](./roadmap.md#removed-resources)).

## Compared with other tools

Where tsinfra differs from the tools in the survey behind the [roadmap's ideas](./roadmap.md#ideas), led by its
strengths:

|                      | tsinfra                                                                     | Others                                                                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Needs on the host    | `sh` and `sshd`                                                             | Ansible needs Python, except `raw`, which has no check mode or diff. salt-ssh needs Python 3 and sends a "thin" tarball. Chef's agentless mode is Linux only, and Bolt's `apply` installs the Puppet agent. cdist matches tsinfra. |
| When state is read   | Just before each step's fix, and again after it                             | pyinfra reads facts in a prepare phase before any change, and its docs warn they go stale. cdist runs every explorer before any code.                                                                                              |
| How honest `plan` is | A step that depends on a change waits with `needs`, and follow-up runs show | Chef calls its own why-run mode "harmful" because it can only forecast. Ansible modules without check-mode support report nothing. Puppet's noop skips refreshes.                                                                  |
| Order                | Top to bottom, as written                                                   | Puppet orders by a graph. cdist's order is undefined without dependencies.                                                                                                                                                         |
| Reacting to a change | Typed `changed` results passed to `after`                                   | Ansible handlers run at the end of the play. cdist types grep message files.                                                                                                                                                       |
| Language             | TypeScript, with typed options and template literals                        | YAML, DSLs, or shell scripts with a file per parameter                                                                                                                                                                             |
| State file           | None, only a small saved state on each host that holds open changes         | Ansible and pyinfra keep none, so a handler that a failed run never reached is lost. Terraform needs one because it creates resources.                                                                                             |

## Example

Host files live in the repo that uses tsinfra (`~/homelab`), not in tsinfra itself.

```ts
// hosts/sonarr.ts
import { host } from "tsinfra"

import { base } from "../lib/base.ts"

export default host({ name: "sonarr", target: "sonarr.lan" }, async (h) => {
  await base(h)

  await h.ensure("Install Sonarr", {
    want: true,
    check: "test -x ~/Sonarr/Sonarr",
    fix: async ({ exec }) => {
      await exec(
        "curl -fsSLo sonarr.tar.gz 'https://services.sonarr.tv/v1/download/main/latest?version=4&os=linux&arch=x64'",
      )
      await exec("tar -xzf sonarr.tar.gz")
      await exec("rm sonarr.tar.gz")
    },
  })

  const unit = await h.file(
    "/etc/systemd/system/sonarr.service",
    Bun.file(new URL("../files/sonarr.service", import.meta.url)),
    { sudo: true },
  )
  await h.run("Reload systemd", "sudo systemctl daemon-reload", { after: [unit] })

  await h.ensure("Start Sonarr", {
    want: "active",
    check: "systemctl is-active sonarr",
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

|           |                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------ |
| **Host**  | A file in `hosts/` that exports `host({ name, target, sudo? }, fn)`. The CLI picks it by `name`. |
| **Step**  | One call on `h`, like `h.ensure` or `h.read`. Steps run one at a time.                           |
| **Need**  | An earlier step whose change a step's state depends on, named in `needs`.                        |
| **Plan**  | Read every step's state, run no fix. Show what would change.                                     |
| **Apply** | Read every step's state, and run the fix wherever it differs.                                    |

## Contents

- **[Steps](./steps.md)**: choosing a method, `ensure`, `file`, `run`, `read`, `inspect`, verification, and what
  happens on failure
- **[Waiting on earlier steps](./needs.md)**: `needs`, and how `plan` waits on an earlier change
- **[Transport](./transport.md)**: local and SSH, ControlMaster, sudo, and how commands and files cross
- **[CLI](./cli.md)**: the `hosts/` folder, `plan` and `apply`, output, and exit codes
- **[Recipes](./recipes.md)**: patterns that need no tsinfra feature
- **[Roadmap](./roadmap.md)**: what's planned, the open questions, ideas from other tools, and what was rejected

## Runtime

tsinfra runs on Bun and requires it. The library uses Bun APIs, including Bun Shell, and may ship Bun Shell helpers
for host scripts. Host scripts can use Bun APIs too.

The CLI loads `hosts/*.ts` with a dynamic import, which Bun runs as TypeScript directly. Host files import `"tsinfra"`,
so tsinfra has to be installed in the repo that uses it (a dev dependency run with `bunx`). A global install would not
resolve that import.
