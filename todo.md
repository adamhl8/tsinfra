# todo

What's left before tsinfra can run the homelab, in order, then the ports that decide the
[open questions](./docs/open-questions.md). Each stage is usable on its own.

## Next

1. **Verbosity levels.** In four pieces, each reviewed before the next (the design is in [CLI](./docs/cli.md#output)).
   Each piece gets its own plan in `docs/superpowers/plans/`, written when it starts, and each step in it is reviewed
   on its own. Every step ends with `tsc` and `bask lint` passing, and a step that changes what's recorded also runs
   `bask test-docker`. Each piece adds a preview pass for its level, to check the output by eye:
   1. **The levels and `-v`.** `-v` counted with Optique's `.multiple()`, which already parses `-vvv`, `-v -v`, and
      `--verbose -vv`, capped at 3, and a `verbosity` level in `ReportOptions`. A host with no steps gets its "no steps"
      block by default. The builders give every piece of a block the level it shows from, and one `keepShown` filter in
      `renderHostBlock` prunes them before any column is sized. A `sudo` boolean on `StepRecord`, because `sudo: true`
      is a step option, and every command in the step runs as root. The session recorder's `getShell` splits in two:
      `getStepShell({ sudo })` records `sudo` on the running step and returns its shell, and `getToolShell()` gives
      the tools theirs, which never use sudo. `-v` shows it as `sudo` in the entry's note, before any `needs`. Its
      steps are in `docs/superpowers/plans/2026-11-11-verbosity-piece-1.md`:
      1. **Count `-v` (built).**
      2. **"no steps" by default (built).**
      3. **The block's structure (built), step 3a.** The `HostBlock` types, build, style, and layout, and a report that
         only renders, with the summary and the exit code read from the blocks.
      4. **The running step on the host record (built), step 3d.** `stepRecords` holds only finished steps, and a step
         that fails is the failure's.
      5. **The diff's limits (built), step 3b.**
      6. **Levels and the filter, step 3c.** Once it removes `isStepShown`, fold `getStepWarnings` into
         `toWarningDetails` in `src/report/build/details/details.ts`, because it'll be the only caller, and the rule then
         sits with the detail it makes.
      7. **`StepRecord.sudo` and the two shells, step 4.**
      8. **The `sudo` note, step 5.**
      9. **A docs check, step 6.**
   2. **`secret` on commands.** The `secret` option [Steps](./docs/steps.md#commands) gives `read`, `exec`, `inspect`,
      `ensure`, and `run` isn't built, and `-vv` prints the text of every command that ran, so it comes first. `file`'s
      own `secret` is a different option, which never fetches the old content. Settle the design in a rundown before
      its plan. The leanings so far:
      - **The record** holds `<secret command>` in place of the command, like the `<sudo password>` stand-in, and
        drops stdout and stderr. It keeps the exit code, which gives nothing away, so `-vvv` can still show it.
      - **Errors** leave out the command and its stderr, like `failed to read <secret command> -> exited with code 1`,
        because the docs promise to keep a secret out of errors, not only out of the report.
      - **A secret `h.read` or `h.inspect`** takes the stand-in as its step name, because its name is its command.

      The steps, as expected so far:
      1. **The recorder.** A `secret` flag in the shell's `CommandOptions` records the stand-in and drops the output,
         tested in `session-recorder.test.ts`.
      2. **Errors.** A secret command's failure leaves out its text and its stderr.
      3. **The tools and the read steps.** `secret` on `read`, `exec`, and `inspect` as tools, and on `h.read` and
         `h.inspect`, with the stand-in as the step's name.
      4. **`ensure` and `run`.** `secret` on a string `check`, `fix`, or run command.
      5. **The report.** A secret command never gives a `stderr:` failure row and never counts toward a hint. Then a
         docs check.

   3. **`-vv`.** Each step's commands under its details, tsinfra's own by their label, and the `file` write script's
      label followed by its `validate` command. A preparation failure lists preparation's commands by their labels.
      The steps:
      1. **Command parts.** Each command a step ran is a part from 2, shown dimmed as `$ cmd` under the details. One
         with a label shows as `$ (label)`, and a read or inspect lists none. A failed step's commands go under its
         error with its other details. Add an `apply -vv` preview pass.
      2. **`validate`.** The write script records its `validate` command in a field next to `label`, passed through
         `exec`'s options, because a labelled command never shows its text. The report appends it, like
         `$ (file write script) validate: nginx -t ...`. Add it to
         [What a host records](./docs/cli.md#what-a-host-records).
      3. **Preparation's commands.** The `(preparation)` entry lists them as labelled command parts from 2.
      4. **A docs check,** and mark the piece built.
   4. **`-vvv`.** `exit:`, `stdout:`, and `stderr:` rows under each command, each stream cut off after 20 lines, and
      the phase before each command in a step that compares. A failure's note already tells people to run with
      `-vvv`, so `-vvv` has to show the stderr that note promises, and the note itself goes away at `-vvv`. The steps:
      1. **Exit rows.** An `exit:` row from 3 under each command, even for 0, and the error in its place for a command
         that couldn't run. A read or inspect shows its rows right under its head line.
      2. **stdout and stderr rows,** each cut off after 20 lines, with a note saying how many were left out.
      3. **Phases.** In a step that compares, each command starts with its phase, like `before $ cmd`, and its rows
         line up past it, as in the docs' example. It's the hardest alignment in the feature, so it's a step of its
         own.
      4. **`until`.** Parts get an `until` level, and the "run with -vvv" note uses it to go away at 3. Add an
         `apply -vvv` preview pass.
      5. **A docs check,** and mark this item built.

## Port

2. **The Mac.** Port `~/homelab/pyinfra/macbook` to `hosts/macbook.ts`, with its helpers in `~/homelab/lib`. Compare
   `tsinfra plan` against `just plan macbook` on the same machine. This settles the plan output question, and
   tries the sudo prompt from `file` part 6 on a host without passwordless sudo.
3. **Two simple containers.** flaresolverr and byparr, the ones the homelab todo already marks as the place to start.
   Then sonarr, which needs a systemd unit and a `needs`.
4. **Revisit the open questions** with those ports as evidence, and decide which helpers move into tsinfra.

## Later

Decided, and wanted eventually, with no place in the order yet.

- **Reboot.** `h.reboot({ after, timeout })`: the boot id read before and after, `sudo reboot` started in the
  background, the ControlMaster socket dropped, polling until the host answers, and `@local` refused (see
  [Steps](./docs/steps.md#reboot)). It needs SSH. The Incus host needs it after a kernel change, and until then it
  reboots by hand.
- **Running hosts in parallel.** Up to `--parallel <n>` at once, with each host's output held until it finishes, and the
  live progress area under the finished blocks (see [CLI](./docs/cli.md#live-progress)).
- **Diagnostic logs.** LogTape on stderr, with `@optique/logtape` adding `--log-level` and `--log-output`, but not its
  `-v` form, because `-v` sets the report's level (see
  [CLI](./docs/cli.md#diagnostic-logs)).
- **Tasks.** `task(name, fn)`, registered with `host(target, fn, { tasks: [...] })`, and `--task <name>` on `plan` and
  `apply`, running only hosts that have it (see [CLI](./docs/cli.md#tasks)).
- **The `shell` host option.** `{ shell: ["bash", "-l", "-s"] }` replaces the whole `sh -s` on both transports, and
  under `sudo: true`. tsinfra runs the array as it is locally, quotes each word over SSH, and checks nothing about
  the shell (see [Login shells](./docs/transport.md#login-shells)). Skipped from the SSH pieces on 2026-11-11, because
  nothing needs it yet. Its tests: a local `env` word that sets a variable the script reads, and over SSH a `sh -l`
  that sees an export from the SSH user's `.profile`.
- **Ordering between hosts.** `needs` on `host()`, taking imported host scripts. The design is tentative, and it comes
  after `--parallel` and most of the rest of this file (see
  [Open questions](./docs/open-questions.md#ordering-between-hosts)).

## Follow-ups

- **Stop remote commands on Ctrl-C.** Without a terminal, Ctrl-C ends the local `ssh`, but the command on the host
  keeps running. nixos-rebuild runs a remote `pkill -SIGINT` when it's interrupted. tsinfra needs the same, with the
  process to stop known, and the run's connections still closed.
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

  - **A reboot before `h.reboot` exists,** as an `ensure` after the steps that need it. The check reads the state only
    a reboot brings, and the fix schedules the reboot and fails the host on purpose:

    ```ts
    await h.ensure("Reboot to load ZFS", {
      check: "test -e /sys/module/zfs",
      want: true,
      fix: "sudo systemd-run --on-active=5 systemctl reboot && echo 'rebooting, rerun in a minute' >&2 && exit 1",
    })
    ```

    `systemd-run` delays the reboot, so the command returns before the connection drops. The failure skips the rest of
    the host's steps, and the next run starts past this one, because the check passes after the reboot. `plan` shows
    it as a change, which a bare `throw` in the script wouldn't. For a kernel update, compare `uname -r` with the
    newest `/boot/vmlinuz-*`. The same shape works as a pause for a manual login, with a fix that only fails with
    the instructions, like `ssh in and run 'ob login'`.

  - **A config file an app owns,** like Sonarr's `config.xml`, which it creates on first start and rewrites when a
    setting changes in its UI. Seed it before the first start with `overwrite: false`, so the app starts with your
    values, then manage each value you care about with its own `ensure`:

    ```ts
    const configPath = "/home/adam/.sonarr/config.xml"
    await h.file(configPath, `<Config><Port>8000</Port><ApiKey>${sonarrApiKey}</ApiKey></Config>\n`, {
      secret: true,
      overwrite: false,
    })
    await h.ensure("Set Sonarr's port", {
      check: `grep -o '<Port>[0-9]*</Port>' ${configPath}`,
      want: "<Port>8000</Port>",
      fix: `sed -i 's|<Port>[0-9]*</Port>|<Port>8000</Port>|' ${configPath} && sudo systemctl restart sonarr`,
    })
    ```

    The seed avoids waiting for the app to create the file, and puts an API key from sops in place before anything
    reads it. An app that writes its whole config when it stops, like qBittorrent, needs the fix to stop it, edit,
    then start it, or the app's copy overwrites the edit.

  - **A directory of files,** like a built static site, as one `file` step per file, from a loop over the local
    directory:

    ```ts
    import path from "node:path"

    import { Glob } from "bun"

    const siteDir = path.join(import.meta.dir, "../site/dist")
    for await (const relativePath of new Glob("**/*").scan({ cwd: siteDir })) {
      await h.file(`~/dist/${relativePath}`, Bun.file(path.join(siteDir, relativePath)))
    }
    ```

    `file` creates missing parent directories, and an `ensure` sets a directory's mode when it matters (see the
    directory recipe above). A file removed from the local directory stays on the host, so remove it with its own step,
    or rebuild the directory.

  - **A value from your own environment in a `sudo` command.** `sudo` resets the environment, and Debian's
    `secure_path` replaces `PATH` even with `sudo -E`. Read the value as yourself first, and put `sudo` only on the part
    that needs root:

    ```ts
    fix: 'fish_path="$(command -v fish)" && echo "$fish_path" | sudo tee -a /etc/shells && sudo chsh -s "$fish_path" "$USER"'
    ```

    `command -v fish` runs with your `PATH`, and the variable expands before `sudo` sees it, so root's `PATH` never
    matters.

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

## Done

- **Steps.** `ensure` (both check kinds), `run`, `read`, plan and apply modes, verification, and failure marking the
  host so later calls are skipped.
- **`file` parts 1 to 7,** each reviewed before the next (the design is in [Steps](./docs/steps.md#file) and
  [Transport](./docs/transport.md#file-writes)):
  1.  **Reading the state and the plan output.** The GNU and BSD file details script, the local hash, the `file` comparison, the
      content diff and its notes (new, secret, binary, large), the `mode: 644 -> 600` attribute lines, path quoting, and
      `~/` resolved as the SSH user.
  2.  **The write.** In six pieces, each reviewed before the next:
      1. **The signature.** `content` as `file`'s second argument, with every option optional, and a `Blob` like
         `Bun.file(...)` accepted as content, read inside the step.
      2. **The write script and verification.** The write script in its tested order, and verification after it. Now that
         `file` can fail with "still differs", replace the hand-built record in `report.test.ts` that checks labelled
         commands stay out of the stderr rule with a real run.
      3. **Sudo.** `sudo` in the shell and transport for tsinfra's own commands.
      4. **The size limit.** Content over 10 MB fails before anything is sent.
      5. **The symlink refusal.** The file details parser already refuses a symlink in `plan` and `apply`. What's left is a
         test that `apply` refuses one without writing.
      6. **The errors without `sudo`.** An error for `user` naming another user. The error for an unreadable file is
         already built.
  3.  **Links.** In two pieces, each reviewed before the next:
      1. **The `link` step** (see [Steps](./docs/steps.md#link) and [Transport](./docs/transport.md#link-writes)).
      2. **Warnings.** A `warning:` line under a step that worked but needs a look, which shows it even when it's
         already right, and a count in the summary (see [CLI](./docs/cli.md#how-the-report-is-built)). It starts with a
         link to a missing path.
  4.  **Docs and preview.** The preview shows each way a file or a link can look, and the docs for both match the code.
  5.  **Validation.** `validate` on `file`, run against the temp file before the rename, in a temp directory that keeps
      the destination's name (see [Steps](./docs/steps.md#the-write) and [Transport](./docs/transport.md#file-writes)).
  6.  **Sudo passwords.** In three pieces, each reviewed before the next (the design is in
      [Transport](./docs/transport.md#sudo)):
      1. **The option, the check, and askpass for a password given in `host()`.** `sudo?: true | { password }` on
         `host()`, the `sudo -n -k true` check in preparation, and the askpass preamble with `~/.tsinfra/askpass.sh` on a
         host given a password.
      2. **The prompt.** A `sudo: true` host whose sudo needs a password prompts for it in preparation, after every host
         is prepared, one host at a time in the hosts' order. Every password is checked with `sudo -k -S`, so a wrong
         one logs one failed try, and `readHiddenLine` reads it with `node:readline` muted.
      3. **The hint for a host that doesn't declare `sudo`.** Its `sudo` stays `sudo -n`. A host that leaves `sudo`
         off and fails after sudo's `a password is required` gets a hint under its failure in the report:
         `sudo needs a password on this host, so set the sudo option on host()`. The session decides it when the step
         fails, from the step's own commands and the host's option, and records it on the step, so errors keep sudo's
         own words. A non-English locale doesn't get the hint.

      SSH isn't built yet, so all three are tested against `@local` and in Docker. The flows are the same over SSH.

  7.  **Content written only once.** `overwrite: false` writes a missing file, and leaves an existing one alone, its
      mode and owner included. The comparison returns in sync for an existing file, so nothing else changes.

  The tests run on the platform they run on, so macOS covers the BSD paths. `bask test-docker` covers the GNU and
  busybox paths, and real `sudo` and root, in containers. Real SELinux labels need a VM with it enforcing.

- **Needs.** `needs` on `ensure`, `file`, and `link`, `name` and `kind` on `ChangeStepResult`, and waiting in plan.
- **CLI.** Discovering `hosts/`, the summary, and exit codes.
