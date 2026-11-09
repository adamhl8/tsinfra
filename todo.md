# todo

Build order for the design in `docs/`. Each stage is usable on its own, and the ports at the end are what decide the
[open questions](./docs/open-questions.md).

## Housekeeping

- Make an initial commit. Nothing in the repo is committed yet.

## Build

1. **Transport.** Local and SSH, commands on stdin to `sh -s`, the `{ ... } </dev/null` wrapper, ControlMaster options,
   the `sudo` preamble, the `shell` host option, and `ssh -G` deciding `accept-new` and `ConnectTimeout`. Integration tests against a real local shell and a real sshd. Test the file
   write rule on dash, bash, busybox sh, and macOS `/bin/sh`. `bask test-docker` already covers dash and busybox, and the sshd joins it. The sshd and Linux shells run in Docker containers, and
   those tests skip when Docker is not available. The macOS `/bin/sh` case runs only on darwin, so it is local only.
   Test a command that can't run after the session starts, like sshd going away mid-run: it fails the host, and the
   step's record keeps the command and its error.
2. **Steps.** `step` (both check kinds), `run`, `read`, plan and apply modes, verification, and failure marking the
   host so later calls are skipped.
3. **`file`.** In seven parts, each reviewed before the next (the design is in [Steps](./docs/steps.md#file) and
   [Transport](./docs/transport.md#file-writes)):
   1. **Reading the state and the plan output.** The GNU and BSD file details script, the local hash, the `file` comparison, the
      content diff and its notes (new, secret, binary, large), the `mode: 644 -> 600` attribute lines, path quoting, and
      `~/` resolved as the SSH user.
   2. **The write.** In six pieces, each reviewed before the next:
      1. **The signature.** `content` as `file`'s second argument, with every option optional, and a `Blob` like
         `Bun.file(...)` accepted as content, read inside the step.
      2. **The write script and verification.** The write script in its tested order, and verification after it. Now that
         `file` can fail with "still differs", replace the hand-built record in `format.test.ts` that checks labelled
         commands stay out of the stderr rule with a real run.
      3. **Sudo.** `sudo` in the shell and transport for tsinfra's own commands.
      4. **The size limit.** Content over 10 MB fails before anything is sent.
      5. **The symlink refusal.** The file details parser already refuses a symlink in `plan` and `apply`. What's left is a
         test that `apply` refuses one without writing.
      6. **The errors without `sudo`.** An error for `user` naming another user. The error for an unreadable file is
         already built.
   3. **Links.** In two pieces, each reviewed before the next:
      1. **The `link` step** (see [Steps](./docs/steps.md#link) and [Transport](./docs/transport.md#link-writes)).
      2. **Warnings.** A `warning:` line under a step that worked but needs a look, which shows it even when it's
         already right, and a count in the summary (see [CLI](./docs/cli.md#how-the-report-is-built)). It starts with a
         link to a missing path.
   4. **Docs and preview.** The preview shows each way a file or a link can look, and the docs for both match the code.
   5. **Validation.** `validate` on `file`, run against the temp file before the rename, in a temp directory that keeps
      the destination's name (see [Steps](./docs/steps.md#the-write) and [Transport](./docs/transport.md#file-writes)).
   6. **Sudo passwords.** In three pieces, each reviewed before the next (the design is in
      [Transport](./docs/transport.md#sudo)):
      1. **The option, the check, and askpass for a password given in `host()`.** `sudo?: true | { password }` on
         `host()`, the `sudo -n -k true` check in preflight, and the askpass preamble with `~/.tsinfra/askpass.sh` on a
         host given a password.
      2. **The prompt.** A `sudo: true` host whose sudo needs a password prompts for it in preflight, after every host
         is prepared, one host at a time in the hosts' order. Every password is checked with `sudo -k -S`, so a wrong
         one logs one failed try, and `readHiddenLine` reads it with `node:readline` muted.
      3. **The hint for a host that doesn't declare `sudo`.** Its `sudo` stays `sudo -n`. A host that leaves `sudo`
         off and fails after sudo's `a password is required` gets a hint under its failure in the report:
         `sudo needs a password on this host, so set the sudo option on host()`. The session decides it when the step
         fails, from the step's own commands and the host's option, and records it on the step, so errors keep sudo's
         own words. A non-English locale
         doesn't get the hint.

      SSH isn't built yet, so all three are tested against `@local` and in Docker. The flows are the same over SSH.

   7. **Content written only once.** `overwrite: false` on `file`: write a missing file, never read or compare an
      existing one's content, and still manage its attributes (see [Steps](./docs/steps.md#the-write)).

   The tests run on the platform they run on, so macOS covers the BSD paths. `bask test-docker` covers the GNU and
   busybox paths, and real `sudo` and root, in containers. Real SELinux labels need a VM with it enforcing.

4. **Needs.** `needs` on `ensure` and `file`, `name` and `kind` on `ChangeStepResult`, and waiting in plan.
5. **CLI.** Discover `hosts/`, run hosts in parallel, hold output per host, the summary, and exit codes.
6. **Reboot.** `h.reboot({ after, timeout })`: the boot id read before and after, `sudo reboot` started in the background,
   the ControlMaster socket dropped, polling until the host answers, and `@local` refused (see
   [Steps](./docs/steps.md#reboot)). It needs SSH, and lands before the Incus host's port, which needs it after a kernel
   change.

## Follow-ups

- **Fail a tool saved for later.** A script can keep the `read` or `exec` a step function was given and call it after
  that step finished. At the top level its command goes unrecorded, and during a later step it is recorded under the
  wrong step. `callStep` already builds a fresh set of tools for each step. What's left is to bind them to the step's
  record, and fail the host through `callOrFail` when that step is no longer the running one. Do not throw in
  `recordCommands`, because only `session.ts` throws, and a throw there would skip recording the failure in
  `callOrFail`.
- **A recipes section in the user docs.** When the full docs get written, add a cookbook of patterns that need no
  tsinfra feature. Start with these:
  - **A template is a function** in its own `.ts` file, which gives typed parameters, plain loops and conditionals, and
    a template that tests can call:

    ```ts
    // files/caddyfile.ts
    export const caddyfile = (site: { domain: string; port: number }) => `${site.domain} {
      reverse_proxy localhost:${site.port}
    }
    `

    // hosts/sonarr.ts
    await h.file("/etc/caddy/Caddyfile", caddyfile({ domain: "sonarr.lan", port: 8989 }), { sudo: true })
    ```

    A template literal inside indented code keeps that indentation, so keep templates at the top level of their file,
    or use [`dedent`](https://www.npmjs.com/package/dedent) or `outdent` inline. Someone porting Jinja files can render
    them with Nunjucks and pass the output as a string.

  - **Paths on the control machine** with `import.meta.dir` in a `lib/paths.ts` (see
    [Steps](./docs/steps.md#file)).
  - **An idempotence check:** in a container, `apply`, then `plan` expecting exit 0 (see
    [Ideas](./docs/ideas.md#decided)).
  - **Checking a whole config with `run`:** a fragment that only makes sense with the rest of a config is checked after
    it's in place, like `h.run("Reload nginx", "nginx -t && systemctl reload nginx", { after: [site] })`. A `run` with
    `after: "always"` that runs `sshd -t` checks the live config on every `apply`, which catches a config that a new
    version of the tool no longer accepts. `validate` is for a file that must never be broken, even for a moment.
  - **Removing a path with `ensure`:** check `test -e path || test -L path` with `want: false`, because `test -e` is
    false for a dead link, so a check with `-e` alone never removes one.
  - **A directory with `ensure`.** When only its existence matters, check `test -d path` with `want: true`, and fix with
    `mkdir -p path`. When its mode or owner matters too, compare them as a string:

    ```ts
    await h.ensure("Create /srv/sonarr", {
      check: "test -d /srv/sonarr && stat -c '%a %U %G' /srv/sonarr",
      want: "750 sonarr sonarr",
      fix: "sudo install -d -m 750 -o sonarr -g sonarr /srv/sonarr",
    })
    ```

    A missing directory gives empty output, which doesn't match `want`, so the fix runs. The `test -d` stops a regular
    file with the same mode and owner from looking correct. `stat -c` is GNU only, and macOS needs `stat -f`, so a
    helper is worth writing for a script that manages many directories or runs on both.

  - **Turn a step into its removal instead of deleting it.** A deleted step leaves what it made on the host, and tsinfra
    can't know how to undo it (see [Ideas](./docs/ideas.md#removed-resources)). Edit the step, and delete it once every
    host has applied it. Name each direction, because a boolean check shows no values under its `~` line. A function
    keeps both directions side by side:

    ```ts
    // lib/docker.ts
    export const docker = async (h: Host, { present }: { present: boolean }) =>
      h.ensure(present ? "Install Docker" : "Remove Docker", {
        check: "command -v docker",
        want: present,
        fix: present ? INSTALL_DOCKER : REMOVE_DOCKER,
      })

    // hosts/sonarr.ts
    await docker(h, { present: false })
    ```

  - **An empty `want` for "nothing left to do".** When the fix should run only while there's something to act on, like
    images with a newer version, packages to upgrade, or files out of place, the check returns the list of those things
    as lines, and `want` is `""`. The fix runs only when the list isn't empty, `plan` shows exactly which ones as a
    diff from nothing, and the check after the fix confirms the list emptied. A boolean would only say "something".
  - **Running the latest container images,** as an empty-`want` `ensure`. The check reads the registry's digest without
    pulling, and compares it with the image each running container started from, because pulling in a check breaks the
    rule on what a check may change (see [Steps](./docs/steps.md#what-a-check-may-change)). The exact `docker` commands get confirmed when this is
    written:

    ```ts
    await h.ensure("Run the latest images", {
      check: async ({ read }) => {
        const outdated: string[] = []
        for (const { service, image } of services) {
          const remote = await read(`docker buildx imagetools inspect ${image} --format '{{.Manifest.Digest}}'`)
          const running = await read(`docker inspect --format '{{.Image}}' $(docker compose ps -q ${service})`)
          if (!(await isSameImage(read, running, remote))) outdated.push(service)
        }
        return outdated.join("\n")
      },
      want: "",
      fix: "docker compose pull && docker compose up -d",
    })
    ```

    `plan` shows a change only when a newer image exists, naming the services. It reads the registry on every plan, one
    manifest request per image, which Docker Hub doesn't count against its pull limit.

    **Use with caution: pulling in the check.** It's simpler, and it breaks tsinfra's rule that `plan` changes nothing
    the script manages. Every `plan` pulls, which moves each image tag on the host, so a `docker compose up -d` run by
    anything afterwards starts the new image, even though nothing was applied. Every plan also downloads, and counts
    against Docker Hub's pull limit, which an hourly drift check can reach. Use it only if those costs are fine for
    this host:

    ```ts
    await h.ensure("Run the latest images", {
      check: async ({ read }) => {
        await read("docker compose pull")
        const outdated: string[] = []
        for (const { service, image } of services) {
          const pulled = await read(`docker image inspect --format '{{.Id}}' ${image}`)
          const running = await read(`docker inspect --format '{{.Image}}' $(docker compose ps -q ${service})`)
          if (pulled !== running) outdated.push(service)
        }
        return outdated.join("\n")
      },
      want: "",
      fix: "docker compose up -d",
    })
    ```
- **A comparison table in the user docs.** When the full docs get written, add a table of how tsinfra compares with other
  config tools, led by its strengths. What the survey in [Ideas](./docs/ideas.md) found so far:

  |                      | tsinfra                                                                     | Others                                                                                                                                                                                                                             |
  | -------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Needs on the host    | `sh` and `sshd`                                                             | Ansible needs Python, except `raw`, which has no check mode or diff. salt-ssh needs Python 3 and sends a "thin" tarball. Chef's agentless mode is Linux only, and Bolt's `apply` installs the Puppet agent. cdist matches tsinfra. |
  | When state is read   | Just before each step's fix, and again after it                             | pyinfra reads facts in a prepare phase before any change, and its docs warn they go stale. cdist runs every explorer before any code.                                                                                              |
  | How honest `plan` is | A step that depends on a change waits with `needs`, and follow-up runs show | Chef calls its own why-run mode "harmful" because it can only forecast. Ansible modules without check-mode support report nothing. Puppet's noop skips refreshes.                                                                  |
  | Order                | Top to bottom, as written                                                   | Puppet orders by a graph. cdist's order is undefined without dependencies.                                                                                                                                                         |
  | Reacting to a change | Typed `changed` results passed to `after`                                   | Ansible handlers run at the end of the play. cdist types grep message files.                                                                                                                                                       |
  | Language             | TypeScript, with typed options and template literals                        | YAML, DSLs, or shell scripts with a file per parameter                                                                                                                                                                             |
  | State file           | None                                                                        | Same as Ansible and pyinfra. Terraform needs one because it creates resources.                                                                                                                                                     |

- **Hint on a failed triggered run.** When a run with `after` fails, end its error with a hint that the steps it follows
  won't show as changed on the next apply, so it needs a manual rerun once fixed (see [Steps](./docs/steps.md#run)).

## Port

7. **The Mac.** Port `~/homelab/pyinfra/macbook` to `hosts/macbook.ts`, with its helpers in `~/homelab/lib`. Compare
   `tsinfra plan` against `just plan macbook` on the same machine. This settles the plan output question, and
   tries the sudo prompt from `file` part 6 on a host without passwordless sudo.
8. **Two simple containers.** flaresolverr and byparr, the ones the homelab todo already marks as the place to start.
   Then sonarr, which needs a systemd unit and a `needs`.
9. **Revisit the open questions** with those ports as evidence, and decide which helpers move into tsinfra.

## Later

Decided, and wanted eventually, with no place in the order yet.

- **Tasks.** `task(name, fn)`, registered with `host(target, fn, { tasks: [...] })`, and `--task <name>` on `plan` and
  `apply`, running only hosts that have it (see [CLI](./docs/cli.md#tasks)).
- **Verbosity levels.** `-vv` lists each step's commands, with labels for tsinfra's own, and `-vvv` adds their output
  (see [CLI](./docs/cli.md#output)). A failure's note already tells people to run with `-vvv`, so `-vvv` has to show the
  stderr that note promises. A command that `sudo: true` ran as root gets a `sudo` boolean on `CommandRecord`,
  set in `createStepShell`, because the record holds the script without the `sudo sh -s` around it. The report
  shows it as a tag, not as the wrapped command.
- **Ordering between hosts.** `needs` on `host()`, taking imported host scripts. The design is tentative, and it comes
  after `--parallel` and most of the rest of this file (see
  [Open questions](./docs/open-questions.md#ordering-between-hosts)).
