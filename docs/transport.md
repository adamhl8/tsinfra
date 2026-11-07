# Transport

Two transports, local and SSH. Both run the same scripts the same way. The only difference is the command that starts
the remote shell.

<!-- toc -->

- [Commands travel on stdin](#commands-travel-on-stdin)
- [Login shells](#login-shells)
- [File writes](#file-writes)
  - [How other tools write files](#how-other-tools-write-files)
- [SSH and ControlMaster](#ssh-and-controlmaster)
- [sudo](#sudo)

<!-- tocstop -->

```ts
export default host("sonarr.lan", async (h) => { ... }) // SSH, any target ssh accepts
export default host("@local", async (h) => { ... }) // the control machine itself
export default host("caddy.lan", { shell: "bash -l" }, async (h) => { ... })
```

`"@local"` is the same magic name pyinfra uses, and the one `~/homelab/pyinfra/inventory.py` already uses.

## Commands travel on stdin

Every command is sent as a script on stdin to a shell on the host. The command that starts that shell is always a
fixed string:

```sh
ssh <options> sonarr.lan sh -s  # SSH
sh -s                           # local
```

A command that escalates says `sudo` inside the script, so the shell itself never starts under sudo (see [sudo](#sudo)).

The remote login shell only ever parses `sh -s`, so the content of a command never needs quoting for it. Whether that
login shell is bash or fish, nothing changes. This is the fix for the "three shells involved" quoting problem in
`~/homelab/archive/incus-update/utils.ts`.

The script is wrapped as `{ <script>\n} </dev/null`. The shell parses the whole group before running it, then runs it
with stdin from `/dev/null`. Without that wrapper, a command in the script that reads stdin (`apt` asking a question, a
nested `ssh`) would read the rest of the script as its input.

Output comes back as stdout, stderr, and an exit code. `ssh` itself exits 255 when the connection fails, so a 255
always gets the connection error from ssh's stderr rather than being treated as the command's exit code.

## Login shells

`sh -s` is not a login shell, so PATH additions from `.bashrc` or `.profile` do not load. The archived Bun scripts used
`bash -li` for exactly that (Go's path lives in `.bashrc` on the caddy container).

The host option `shell` replaces `sh` in the starting command, so `{ shell: "bash -l" }` runs `bash -l -s`. Generated
commands (`file`'s details command and write) are POSIX sh, so any `shell` must be POSIX compatible. fish is not.

## File writes

`file` writes with one script, run on the host by `sh -s`, and in a nested `sudo sh -s` with `sudo: true`. The content travels
inside the script, base64-encoded in a quoted heredoc, and lands in a temp file next to the destination:

```sh
set -eu
mkdir -p '/etc/app'                                 # 1. parent directories, before the umask
umask 077                                           # 2. new files start private
tmp=$(mktemp '/etc/app/.app.conf.tsinfra.XXXXXX')   # 3. a unique temp file next to the destination
trap 'rm -f "$tmp"' EXIT                            #    removed if anything below fails
base64 -d > "$tmp" <<'__TSINFRA_EOF__'              # 4. the content, decoded into the temp file
<content as base64>
__TSINFRA_EOF__
chown -- '1000:1000' "$tmp"                         # 5. user and group first
chmod 644 "$tmp"                                    #    then the mode
chcon --reference='/etc/app/app.conf' "$tmp"        # 6. an existing file's SELinux label, when chcon exists
mv -f "$tmp" '/etc/app/app.conf'                    # 7. one rename puts it in place
trap - EXIT
restorecon '/etc/app/app.conf'                      # 8. a new file's default SELinux label, when restorecon exists
```

Each step's place in the order matters:

1. **`mkdir -p` runs before `umask 077`,** so a parent directory it creates gets the usual permissions. After the
   umask it would come out `0700`, and a daemon that isn't root couldn't reach the file.
2. **`umask 077`** means the temp file exists only as private, so a secret is never readable while it is written.
3. **`mktemp` creates the temp file exclusively,** with a name nobody can predict. A fixed name could be a symlink
   someone planted, and writing to it would follow the link. The temp file sits in the destination's directory, so the
   final rename stays on one filesystem and is atomic. `mktemp` exists on GNU, BSD and macOS, and busybox.
4. **The heredoc** is part of the script, so the shell parses it before running anything, and the content arrives
   intact whatever the shell's buffering. The delimiter has underscores, which base64 never contains, so no line of the
   content can end it early.
5. **`chown` comes before `chmod`,** because `chown` clears setuid and setgid, even when root runs it. Chef and cdist
   both have comments about this. With no `user`, `group`, or `mode` given, the values come from the existing file, as
   the file details command found them, or the defaults for a new file. `chown` runs whenever there's a value, because
   the temp file's owner is whoever ran the script. So a write without `sudo` to a file owned by someone else is refused
   before it starts (see [Steps](./steps.md#sudo-and-permissions)), and never takes ownership away from an app. A new file with no `user` or `group` skips it.
   `chown` keeps its `--`, because a user or group name comes from the script. Paths need none, because they're always
   absolute.
6. **SELinux.** `mv` keeps the temp file's label, so the replacement takes the old file's label first. Both SELinux
   steps run only when the command exists, and a failure is ignored, because `chcon` can exist on a system with SELinux
   off, and then it fails.
7. **`mv -f`** is the only moment the destination changes, so it is always either the old file or the complete new one,
   already with its owner and mode.
8. **`restorecon`** gives a newly created file the label the policy expects. It skips an existing file, because it
   could reset a label that `chcon` just kept.

No step runs `fsync` before the rename. A crash at the wrong moment could leave the new file empty after a reboot.
Ansible and Chef skip it too, and Puppet and Salt don't (see
[Open questions](./open-questions.md#fsync-before-the-rename)).

The record never holds the content. It stores the script with `<content as base64>` in place of the heredoc's content,
because the content may be a secret, and it can be large.

An earlier draft streamed the raw bytes after the script and let `cat` read them. dash and busybox sh both read ahead on
stdin and swallow part of the content, so that only worked under bash and zsh. A 10 MB binary through the heredoc arrives
intact under dash, bash, busybox sh, zsh, and macOS `/bin/sh`.

### How other tools write files

Researched from the source of Ansible, pyinfra, Salt, Chef, Puppet, and cdist:

| Tool    | Hash                 | Transfer    | Temp file                                | sudo                       |
| ------- | -------------------- | ----------- | ---------------------------------------- | -------------------------- |
| Ansible | sha1, in Python      | SFTP or scp | `~/.ansible/tmp`, then a rename          | upload, then root moves it |
| pyinfra | sha1, md5, or sha256 | SFTP        | the destination, or `/tmp` then `cp`     | upload, then `sudo cp`     |
| Salt    | sha256               | agent       | destination's directory, `fsync`, rename | runs as root               |
| Chef    | sha256               | agent       | destination's directory, `mv`            | runs as root               |
| Puppet  | sha256               | agent       | destination's directory, `fsync`, rename | runs as root               |
| cdist   | `cksum` (CRC32)      | scp         | destination's directory, not atomic      | connects as root           |

Ansible applies the mode and owner after its rename, and falls back to the destination's directory when the rename
would cross filesystems. pyinfra writes straight to the destination without sudo, so its write isn't atomic there.
Chef sets the owner before the mode. Puppet sets the mode before its rename. cdist sets the mode last.

What tsinfra takes from them, and where it differs:

- **The hash, the temp file in the destination's directory, and owner before mode** match the careful tools.
- **Setting mode and owner on the temp file before the rename** follows Puppet. Ansible, Chef, Salt, and pyinfra apply
  them after, which leaves a moment where the file is in place with the wrong permissions.
- **The transfer differs.** Every agentless tool uses SFTP or scp. SFTP always writes as the SSH user, so for a
  root-owned file they upload to a user-writable place like `/tmp`, then a root command copies or moves it into place.
  That second hop is where pyinfra (a `cp`) and Chef (an `mv` across filesystems from `/tmp`) lose atomicity. SFTP's
  real advantage is streaming large files. tsinfra's script runs as one user from start to finish, so there is no hop,
  and the 10 MB limit keeps the heredoc to the files it suits (see [Steps](./steps.md#file)).

## SSH and ControlMaster

tsinfra runs the system `ssh` binary. That means `~/.ssh/config`, `ProxyJump`, `known_hosts`, and the SSH agent
(including 1Password's) all work with no tsinfra configuration.

Every `ssh` call passes:

```sh
-o ControlMaster=auto -o ControlPath=~/.ssh/tsinfra-%C -o ControlPersist=60 -o BatchMode=yes
```

- **ControlMaster** makes the first `ssh` to a host open a connection and leave a socket on the control machine. Every
  later `ssh` to that host goes through the socket and skips the TCP connect, key exchange, and authentication, so a
  command starts in milliseconds.
- **ControlPath** uses `%C`, a hash of the connection details, which keeps the socket path short. Unix socket paths
  are limited to about 104 bytes on macOS. The `tsinfra-` prefix keeps these sockets apart from any the user configures.
- **ControlPersist** keeps the connection open for 60 seconds after the last command. That is a safety net, because the
  CLI closes each connection at the end of the run with `ssh -O exit`.
- **BatchMode** makes ssh fail instead of prompting. Hosts run in parallel, and a password or host-key prompt from one
  of them would hang the run. The error says to run `ssh <host>` once by hand.

The first command to a host, the home read when it's prepared, opens the connection. An unreachable host fails
there, before its script runs, with ssh's error.

**Host keys and timeouts follow `~/.ssh/config`, with defaults where it says nothing.** A command-line `-o` always beats
the config file, so tsinfra reads the host's effective settings first, with `ssh -G <host>`. That runs locally, with no
network, once per host in preflight. Then it fills in only what ssh would otherwise leave unworkable:

| `StrictHostKeyChecking` | tsinfra passes | Why                                                                     |
| ----------------------- | -------------- | ----------------------------------------------------------------------- |
| `ask`, the default      | `accept-new`   | `ask` can't prompt under `BatchMode`, so every new host would fail      |
| `yes`                   | nothing        | The user chose strict. An unknown host fails, with a hint to `ssh` once |
| `accept-new` or `no`    | nothing        | Neither prompts                                                         |

- **What the settings mean.** For an unknown host, `yes` refuses, `ask` prompts and saves the key if you accept, and
  `accept-new` and `no` save it silently. For a changed key, all but `no` refuse. `-G` can't tell an explicit `ask`
  from the default, so an explicit `ask` gets upgraded too. It couldn't prompt anyway, and `yes` is the setting that
  keeps tsinfra strict.
- **A changed key always fails,** because `accept-new` refuses one too, and a changed key can mean the host isn't the
  one it was. tsinfra adds `if the host was recreated, remove its old key with ssh-keygen -R <host>`, and offers no way
  around it. A homelab container recreated under the same name hits this, unless cloud-init gives it a stable key.
- **`ConnectTimeout=10`** is passed when `-G` shows `connecttimeout none`, ssh's default, which leaves it to the OS and
  can take about 75 seconds. A timeout the user set is kept.
- **Connect retries are left to ssh.** `ConnectionAttempts` defaults to 1, and `-G` can't tell that from an explicit 1.

## sudo

Commands say `sudo` themselves, exactly where they need it, like `fix: "sudo systemctl enable --now sonarr"` or
`curl -fsSL ... | sudo tar -x -C /opt`. Only that command escalates, and the rest of a pipeline runs as the SSH user.
No command step or tool takes a `sudo` option. `file` and `link` do, because tsinfra writes their commands, so there's
nowhere else to put it (see [Steps](./steps.md#sudo-and-permissions)).

A host whose sudo needs a password declares `sudo` on `host()`. It's off by default, and a passwordless host can leave
it off, because its `sudo` runs as `sudo -n`, which works there:

```ts
export default host("macbook", fn, { sudo: true }) // prompts when passwordless sudo isn't set up
export default host("incus.lan", fn, { sudo: { password: incusSudo } }) // a password the script decrypted, never prompts
```

One option has both forms, because a password already implies sudo. The Incus containers have passwordless sudo
through cloud-init. The Mac and the first run on the Incus host need a password.

**Preflight.** Every host is prepared before any script runs: connect, read `$HOME`, and for a host that declares
`sudo`, probe it. Then the scripts run, one after another or in parallel. Prompts happen in between, one host at a time,
so they never mix with a running host's output. A host that can't be reached fails here, before any other host changes
anything. A host has to declare `sudo` because of this: by the time its script runs, it's too late to ask.

- **The probe** runs `sudo -n true`. When it works, the host is passwordless and never prompts.
- **Otherwise tsinfra needs a password:** the one given in `host()`, or a prompt like
  `sudo password for adam on macbook:`. It checks the password with `sudo -k -A true`. A wrong one prompts again, up to
  three tries like sudo itself, then the host fails with `incorrect sudo password`. A wrong password from `host()`
  fails straight away.
- **No terminal, no prompt.** When stdin isn't a TTY, like in CI, a host that needs a prompt fails in preflight with
  `needs a sudo password: set up passwordless sudo, or pass sudo: { password } to host()`.

**How a command's `sudo` gets the password.** On a host that declares `sudo`, every script tsinfra sends starts with a
short preamble. It writes a temp askpass helper, deleted when the script ends, and defines `sudo` as a shell function:

```sh
sudo() { SUDO_ASKPASS="$__tsinfra_askpass" command sudo -A "$@"; }
```

With `-A`, sudo runs the `SUDO_ASKPASS` program when it needs a password and reads the password from what it prints.
It was made for graphical password dialogs, and here the helper prints the password tsinfra holds. sudo only calls it
when it wants a password, so on a passwordless host, or with cached credentials, the helper never runs. sudo's own
cached credentials can't stand in for this, because they belong to one terminal session, and every tsinfra command is a
new session with no terminal.

- **The password never goes into a command line or the record.** The helper reads it from a variable the function sets
  for that one `sudo` call, and the script that sets it travels on stdin. Root and the same user can still see it while
  the command runs, the same as Ansible's become password.
- **The record shows the command as written,** like `sudo systemctl restart caddy`.
- **tsinfra's own commands escalate the same way,** through the same function, so the command that starts the shell is
  always plain `sh -s`. With `sudo: true`, the step's script runs in a nested `sudo sh -s`, sent in a heredoc with a
  random delimiter, because a path in the script can hold any line. The record holds the step's script as tsinfra wrote
  it, without the nesting.
- **A `sudo` inside a child process,** like a script file the command runs, or `xargs sudo`, doesn't see the function.
  Exporting `SUDO_ASKPASS` might cover it, which needs checking against sudo's docs when this is built. Until then those
  need passwordless sudo.

**A host that doesn't declare `sudo`** gets a preamble that defines `sudo` as `sudo -n`. On a passwordless host that's
all it needs. Where a password is needed, a plain `sudo` over SSH fails anyway, with no terminal to prompt on, but
locally it could open the real terminal and prompt in the middle of the report. With `-n` it fails straight away with
sudo's `a password is required`, and tsinfra adds `host() needs sudo: true`.

On `file`, `sudo: true` covers the whole operation: the file details command, the diff, and the write. A root-only file under
`/etc` could not be hashed or read otherwise, so `plan` needs sudo too, which preflight provides. Content travels on
stdin, inside the script, so it never shows up in `ps` or in the sudo log, unless sudoers sets `log_input`, which
records stdin.
