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

Every command is sent as a script on stdin to a shell on the target. The command that starts that shell is always a
fixed string:

```sh
ssh <options> sonarr.lan sh -s          # SSH
sh -s                                   # local
ssh <options> sonarr.lan sudo -n sh -s  # sudo, either transport
```

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
commands (`file`'s state command and write) are POSIX sh, so any `shell` must be POSIX compatible. fish is not.

## File writes

`file` writes with one script, run on the target by `sh -s`, or `sudo -n sh -s` with `sudo: true`. The content travels
inside the script, base64-encoded in a quoted heredoc, and lands in a temp file next to the destination:

```sh
set -eu
mkdir -p -- '/etc/app'                              # 1. parent directories, before the umask
umask 077                                           # 2. new files start private
tmp=$(mktemp '/etc/app/.app.conf.tsinfra.XXXXXX')   # 3. a unique temp file next to the destination
trap 'rm -f -- "$tmp"' EXIT                         #    removed if anything below fails
base64 -d > "$tmp" <<'__TSINFRA_EOF__'              # 4. the content, decoded into the temp file
<content as base64, wrapped at 76 columns>
__TSINFRA_EOF__
chown -- '1000:1000' "$tmp"                         # 5. owner and group first
chmod -- 0644 "$tmp"                                #    then the mode
chcon --reference='/etc/app/app.conf' "$tmp"        # 6. an existing file's SELinux label, when chcon exists
mv -f -- "$tmp" '/etc/app/app.conf'                 # 7. one rename puts it in place
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
   both have comments about this. Each runs only when the value changes. With no `owner`, `group`, or `mode` given, the
   values come from the existing file, as the state command found them, or the defaults for a new file.
6. **SELinux.** `mv` keeps the temp file's label, so the replacement takes the old file's label first. Both SELinux
   steps run only when the command exists, and skip quietly otherwise.
7. **`mv -f`** is the only moment the destination changes, so it is always either the old file or the complete new one,
   already with its owner and mode.
8. **`restorecon`** gives a newly created file the label the policy expects.

No step runs `fsync` before the rename. A crash at the wrong moment could leave the new file empty after a reboot.
Ansible and Chef skip it too, and Puppet and Salt don't (see
[Open questions](./open-questions.md#fsync-before-the-rename)).

An earlier draft streamed the raw bytes after the script and let `cat` read them. dash and busybox sh both read ahead on
stdin and swallow part of the content, so that only worked under bash and zsh. A 3 MB binary through the heredoc arrives
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

The first command to a host, the home read when its session starts, opens the connection. An unreachable host fails
there, before its script runs, with ssh's error.

## sudo

`sudo -n` never prompts, so v1 needs passwordless sudo (or cached credentials) on any host where a step uses
`sudo: true`. The Incus containers already have it, via cloud-init. The Mac and the first run on the Incus host do not.
See [Open questions](./open-questions.md).

On `ensure` and `run`, `sudo: true` covers a string fix or command only. Inside a fix or run function, each `exec` takes
its own `sudo`, and so does each `read` and `inspect` in a check function. A step's string `check` runs as the
connecting user unless the command itself says `sudo`, because the user writes that command.

On `file`, `sudo: true` covers the whole operation: the state command, the diff, and the write. tsinfra generates all three, so
there is nowhere for the user to add `sudo`. A root-only file under `/etc` could not be hashed or read otherwise. This
means `plan` also needs passwordless sudo on a host that manages such a file. Content travels on stdin, inside the
script, so it never shows up in `ps` or in the sudo log, unless sudoers sets `log_input`, which records stdin. See
[Steps](./steps.md#sudo-and-permissions) for when to use it.
