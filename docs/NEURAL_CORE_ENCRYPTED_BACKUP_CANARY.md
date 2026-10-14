# Neural Core — encrypted backup and recovery canary

**State: code review only.** This branch does not install packages, enable timers, modify the live VPS, expose ports or upload private data. Requires explicit approval and live operator verification.

## Prerequisites confirmed by user

- PostgreSQL 16-main online and isolated under `neural-core.slice`.
- Dedicated database `neuralcore`, restricted API role, no Internet-facing PostgreSQL port.
- API health 200, authenticated DB readiness 200, anonymous readiness 401.
- Resource use approximately 54 MiB within 1 GiB; Minecraft, Relay and Caddy services remain active.
- Full Minecraft TPS/MSPT comparison during player activity/backups **still pending**.
- No persistent personal conversation data imported remotely at this stage.

## Security design

Backups should be encrypted *before touching persistent disk*. The operator generates an
AGE X25519 private identity on a **trusted machine separate from the VPS**. Only its
**public recipient** is copied to `/etc/neural-core/backup-recipient.txt`.
The VPS must never hold the private identity. The backup service emits an encrypted
PostgreSQL custom-format dump and SHA-256 checksum under root-only
`/var/backups/neural-core`.

There is **no timer**, no automated retention deletion, no cloud upload and no
remote database read/write. Do not enable automatic jobs until retention,
recovery and available disk quotas are certified. A `sha256sum` check covers
transport/integrity only and **does not replace a restore test**.

## 1 — Generate an offline AGE key (trusted workstation, not Oracle)

On a trusted Mac/Linux workstation, install the official `age` binary from a
trusted package manager if needed.

```bash
umask 077
age-keygen -o neuralcore-recovery-identity.txt
age-keygen -y neuralcore-recovery-identity.txt
```

Record the emitted `age1...` recipient, which is public. Keep the
`neuralcore-recovery-identity.txt` private file offline with a redundant
recovery copy, **never in GitHub, Vercel, the API, screenshots or chat**.
Without this private identity you cannot recover any encrypted backups.

## Windows 11: secure and test an AGE identity

Use Windows PowerShell on the trusted PC, **not** on Oracle. The `age`
CLI can emit `warning: writing secret key to a world-readable file` on
Windows. Treat this as a real permission warning and inspect the private file's
ACL before sending encrypted archives to this key.

```powershell
$key = "$env:USERPROFILE\NeuralCore-Recovery\neuralcore-recovery-identity.txt"
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value

# Explicit current-user rule first, then remove inherited access.
icacls.exe $key /grant:r "*${sid}:(F)"
icacls.exe $key /inheritance:r
icacls.exe $key
```

Inspect the ACL output: stop if it grants access to unexpected users or
broad principals such as `Everyone`, `Users`, or `Authenticated Users`.
Do not send, screenshot or log the **secret contents**. Windows ACLs and
group policies vary; where in doubt, check the displayed effective permissions
before treating the key as protected. Keep a second securely stored recovery
identity copy on a separate trusted medium.

One-time **non-sensitive** end-to-end local encryption and decryption test:

```powershell
Set-Location "$env:USERPROFILE\NeuralCore-Recovery"
$recipient = age-keygen -y .\neuralcore-recovery-identity.txt
"Neural Core recovery test" | age -r $recipient -o "$env:TEMP\neural-core-age-test.age"
age -d -i .\neuralcore-recovery-identity.txt "$env:TEMP\neural-core-age-test.age"
Remove-Item "$env:TEMP\neural-core-age-test.age"
```

The decrypted output should contain `Neural Core recovery test`. This only
checks that the identity decrypts a sample message; it does not certify a
PostgreSQL database restore.

## 2 — Stop and review installation before any VPS modification

Confirm `age`, source checkout, live PostgreSQL unit, backups directory, and
available disk space. Do **not** install a new database or change Caddy.

```bash
command -v age || echo "age CLI not yet installed"
command -v pg_dump
systemctl show postgresql@16-main.service -p Slice -p ActiveState
df -h /
```

Only after reviewing service prompts, install `age` if missing:

```bash
sudo env NEEDRESTART_MODE=l apt-get install -y age
```

Decline unrelated service restarts.

In a checkout of this branch, create a root-only destination and add only
the **public** AGE recipient. Replace `PUBLIC_AGE_RECIPIENT_HERE` with the
actual public `age1...` string; do not enter the private key.

```bash
sudo install -d -o root -g root -m 0700 /var/backups/neural-core
printf '%s\n' 'PUBLIC_AGE_RECIPIENT_HERE' \
  | sudo tee /etc/neural-core/backup-recipient.txt >/dev/null
sudo chown root:root /etc/neural-core/backup-recipient.txt
sudo chmod 0644 /etc/neural-core/backup-recipient.txt
```

The API token in `/etc/neural-core/api.token` is unrelated and must not be
read, regenerated, printed or moved as part of backups.

`ops/backup/neural-core-backup.sh --check` checks prerequisites
without writing backup data; `--run` creates an encrypted archive.

For an approved canary installation, deploy the audited script and the
manual-only oneshot unit, **without enabling the unit**:

```bash
sudo install -D -o root -g root -m 0755 \
  ops/backup/neural-core-backup.sh \
  /usr/local/libexec/neural-core-backup
sudo install -D -o root -g root -m 0644 \
  ops/systemd/neural-core-backup.service \
  /etc/systemd/system/neural-core-backup.service
sudo systemctl daemon-reload
sudo /usr/local/libexec/neural-core-backup --check
```

## 3 — Create one encrypted test backup (explicit operator action)

Perform this during quiet Minecraft activity, not during a Minecraft backup.

```bash
sudo systemctl start neural-core-backup.service
systemctl show neural-core-backup.service \
  -p ActiveState -p Result -p ExecMainStatus -p MemoryPeak
sudo journalctl -u neural-core-backup.service -n 15 --no-pager
sudo find /var/backups/neural-core -maxdepth 1 -type f \
  -name 'neuralcore-*.dump.age' -printf '%f %s bytes\n'
```

The unit returns to inactive after successful completion; `Result=success`
must be observed. The backup job remains under `neural-core.slice` for
CPU/IO isolation.

Verify ciphertext checksum without displaying contents:

```bash
sudo bash -c 'cd /var/backups/neural-core && sha256sum -c -- *.sha256'
```

This is **not** a restore test.

## Recovery: hardened-unit runuser/PAM UID failure (2026-10-14)

On Oracle Ubuntu, the first backup attempted to call `runuser -u postgres`
inside the restricted `neural-core-backup.service` and failed:

```text
pam_keyinit(runuser:session): Unable to change UID to 110 temporarily
runuser: cannot set user id: Operation not permitted
```

Cause: `runuser` invokes PAM, which attempts operations beyond the restricted
systemd unit's privileges. A backup was **not completed**. The corrected backup
script uses util-linux `setpriv` for a direct PAM-free
`root -> postgres` identity change with
`--reuid=postgres --regid=postgres --clear-groups`.
Keep `CapabilityBoundingSet=CAP_SETUID CAP_SETGID` and
`NoNewPrivileges=yes`; do not relax other service restrictions.

To deploy **only** the script fix from the reviewed branch, from its
existing shallow working tree:

```bash
cd /tmp/neural-core-backup-canary
git pull --ff-only origin ops/encrypted-backup-recovery-canary
bash -n ops/backup/neural-core-backup.sh
grep -F 'setpriv --reuid=postgres --regid=postgres --clear-groups' \
  ops/backup/neural-core-backup.sh
sudo install -D -o root -g root -m 0755 \
  ops/backup/neural-core-backup.sh /usr/local/libexec/neural-core-backup
sudo /usr/local/libexec/neural-core-backup --check
```

Only after checks pass and no Minecraft backup is running, trigger one
manual backup:

```bash
sudo systemctl reset-failed neural-core-backup.service
sudo systemctl start neural-core-backup.service
systemctl show neural-core-backup.service \
  -p ActiveState -p Result -p ExecMainStatus -p Slice -p MemoryPeak
sudo journalctl -u neural-core-backup.service -n 16 --no-pager
```

The oneshot is normally `inactive` afterward, but `Result=success`
and `ExecMainStatus=0` are required. If the UID change still fails,
**stop** and capture the short journal; don't bypass privilege separation,
run `pg_dump` as root or rerun repeatedly. Retain the encrypted archive
until the later isolated restore test succeeds.

## Recovery: setpriv setresuid blocked by exec capability propagation (2026-10-14)

On the first retry using `setpriv`, the script preflight passed but the backup
service failed with `ExecMainStatus=127` and:

```text
setpriv: setresuid failed: Operation not permitted
```

Root cause: `CapabilityBoundingSet=CAP_SETUID CAP_SETGID` restricted the
privileges a process *may* have but did not ensure the shell interpreter and
subprocess keep those privileges **effective** after `execve`.
With `NoNewPrivileges=yes`, `setpriv` cannot elevate via its executable.
The unit now also sets `AmbientCapabilities=CAP_SETUID CAP_SETGID`,
which propagates **only these two existing bounded capabilities** until
`setpriv` changes identity. It does not widen the bounding set, alter DB
authentication, or disable the systemd sandbox.

Before deploying or starting another backup, verify the intended identity
change in a **disposable systemd unit**, without accessing PostgreSQL or
creating archives:

```bash
sudo systemd-run --unit=neural-core-uid-probe --wait --collect --pipe \
  -p Type=oneshot \
  -p Slice=neural-core.slice \
  -p NoNewPrivileges=yes \
  -p 'CapabilityBoundingSet=CAP_SETUID CAP_SETGID' \
  -p 'AmbientCapabilities=CAP_SETUID CAP_SETGID' \
  -- /usr/bin/setpriv --reuid=postgres --regid=postgres --clear-groups \
     -- /usr/bin/id -un
```

Expected output includes `postgres` and the transient probe job exits
successfully. **If the probe fails, stop; do not retry the real backup**.

After passing, update only the backup unit from the inspected checkout.
The corrected script from the previous step should already be installed:

```bash
cd /tmp/neural-core-backup-canary
git pull --ff-only origin ops/encrypted-backup-recovery-canary
grep -F 'AmbientCapabilities=CAP_SETUID CAP_SETGID' \
  ops/systemd/neural-core-backup.service
sudo install -o root -g root -m 0644 \
  ops/systemd/neural-core-backup.service \
  /etc/systemd/system/neural-core-backup.service
sudo systemctl daemon-reload
sudo systemctl show neural-core-backup.service \
  -p AmbientCapabilities -p NoNewPrivileges -p CapabilityBoundingSet
sudo /usr/local/libexec/neural-core-backup --check
```

Only then, during idle Minecraft activity, trigger **one** manual
`sudo systemctl start neural-core-backup.service` and inspect the resulting
journal/checksum. If it fails again, stop instead of widening capabilities.

## 4 — Certify Windows-based recovery into an isolated database

**First successful encrypted archive:** on 2026-10-14, the manual backup unit
returned `Result=success`, `ExecMainStatus=0` and created
`neuralcore-20261014T005101Z-1932323.dump.age` (11,197 encrypted bytes).
Its SHA-256 checksum passed on Oracle. On the owner’s Windows PC, a
matching SHA-256 was verified, AGE decryption plus `pg_restore --list`
succeeded (exit code 0), and the restored isolated database
`neuralcore_restore_check` was subsequently observed to contain the same
six public base tables as production: `conversations`, `memory_edges`,
`memory_evidence`, `memory_nodes`, `messages`, `sources`.
The existing API/PostgreSQL/Minecraft/Relay services remained active.

**Status: schema-level restoration evidenced, full recovery certification
pending.** The operator has not yet supplied the Windows `pg_restore`
transaction exit code or source/restore row-count comparison. A successful
restore of schema does not validate data, global roles, disaster-recovery
time or offsite retention. Preserve the original ciphertext and private
identity until all gates are satisfied.

### A. Stage ciphertext for download, never the decryption key

On the VPS, create a private staging directory under the SSH account's
home. Only copy the two *encrypted* files; do not modify originals under
`/var/backups/neural-core`.

```bash
archive=neuralcore-20261014T005101Z-1932323.dump.age
install -d -m 0700 "$HOME/neural-core-transfer"
sudo install -o ubuntu -g ubuntu -m 0600 \
  "/var/backups/neural-core/$archive" "$HOME/neural-core-transfer/$archive"
sudo install -o ubuntu -g ubuntu -m 0600 \
  "/var/backups/neural-core/$archive.sha256" "$HOME/neural-core-transfer/$archive.sha256"
(cd "$HOME/neural-core-transfer" && sha256sum -c -- "$archive.sha256")
```

Before using these commands for a different server, confirm the SSH account
is actually `ubuntu` and adapt the ownership and `/home/ubuntu` paths
accordingly. Restrictive staging-file permissions do not replace SSH security.
Clean up the staging copies only **after** a successful recovery test.

### B. Download ciphertext on Windows PowerShell

On the same Windows PC that holds the private AGE identity:

```powershell
$archive = 'neuralcore-20261014T005101Z-1932323.dump.age'
$remote = 'ubuntu@YOUR_VPS_SSH_HOST'
$dir = Join-Path $env:USERPROFILE 'NeuralCore-Recovery'
scp "${remote}:/home/ubuntu/neural-core-transfer/$archive" $dir
scp "${remote}:/home/ubuntu/neural-core-transfer/$archive.sha256" $dir

$checksumLine = (Get-Content -LiteralPath (Join-Path $dir "$archive.sha256") -Raw).Trim()
$expected = ($checksumLine -split '\s+', 2)[0].ToUpperInvariant()
$actual = (Get-FileHash -LiteralPath (Join-Path $dir $archive) -Algorithm SHA256).Hash
if ($expected -ne $actual) { throw 'STOP: encrypted archive checksum mismatch' }
'PASS: encrypted archive SHA-256 matches'
```

Replace only the SSH host placeholder, using the host/address you normally
connect to with your SSH keys. The **private key file itself is never copied
to Oracle**.

### C. Prepare a strictly separate test database

On Oracle, verify the existing production database remains healthy, and
verify the test database **does not exist** before creating it:

```bash
sudo -u postgres psql -d postgres -Atqc \
  "SELECT datname FROM pg_database WHERE datname IN ('neuralcore', 'neuralcore_restore_check');"
```

The expected initial output contains only `neuralcore`.
**Stop if `neuralcore_restore_check` already exists**; do not drop or
overwrite any database. After reviewing that output, create the isolated
empty database and revoke the default PUBLIC connection privilege:

```bash
sudo -u postgres createdb --owner=postgres neuralcore_restore_check
sudo -u postgres psql -d postgres -c \
  'REVOKE CONNECT ON DATABASE neuralcore_restore_check FROM PUBLIC;'
```

From Windows PowerShell, confirm your configured SSH connection can
execute noninteractive PostgreSQL commands **before streaming data**:

```powershell
ssh -T ubuntu@YOUR_VPS_SSH_HOST 'sudo -n -u postgres psql -d postgres -Atqc "SELECT current_user"'
```

Expected `postgres`. If sudo refuses noninteractive operation, **stop** and
request a reviewed restore method; never upload the private AGE identity.

### D. Windows binary-safe restore (Command Prompt, not Windows PowerShell pipe)

**Do not pipe decrypted `age` output through Windows PowerShell 5.1:**
its text-oriented native pipeline can corrupt binary PostgreSQL dumps.
Instead, open **Command Prompt (`cmd.exe`)** in Windows. Standard Windows
native-command pipes preserve binary streams.

First test decryption and dump parsing without modifying any database:

```bat
cd /d C:\Users\Tonim\NeuralCore-Recovery
age -d -i neuralcore-recovery-identity.txt neuralcore-20261014T005101Z-1932323.dump.age | ssh -T ubuntu@YOUR_VPS_SSH_HOST "sudo -n -u postgres pg_restore --list"
```

If parsing succeeds and prints the PostgreSQL custom-format archive's
table-of-contents entries, perform the actual restore **to the test database
only**:

```bat
age -d -i neuralcore-recovery-identity.txt neuralcore-20261014T005101Z-1932323.dump.age | ssh -T ubuntu@YOUR_VPS_SSH_HOST "sudo -n -u postgres pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname=neuralcore_restore_check"
echo restore-exit-code=%ERRORLEVEL%
```

Expect `restore-exit-code=0`. The stream is decrypted locally and sent over
authenticated SSH without writing a plaintext dump archive on either disk.
The restored test database of course stores the recovered records on PostgreSQL
storage; test access is limited by the connection privilege revocation.

If an error occurs, **do not pipe into production** or retry blindly. Preserve
the isolated test DB for investigation. A successful restore is followed by a
schema count and sample row query, compared against the source database:

```bash
for db in neuralcore neuralcore_restore_check; do
  printf '%s: ' "$db"
  sudo -u postgres psql -d "$db" -Atqc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
done
```

Both should report six base tables for the current initial schema. Later,
validate representative record counts and the backup's temporal consistency
when imported conversation data exists. Do **not** claim full disaster
recovery based on a schema-only restoration: PostgreSQL role/global
configuration, retention, offsite copies and recovery time also need
verification.

Keep the test database until inspection is complete; cleanup remains
manual and separately reviewed.

## 5 — Stop criteria and monitoring

- No `age`, missing or invalid recipient, wrong directory ownership,
  unisolated PostgreSQL, database errors or backup space pressure: **stop**.
- Never weaken systemd sandboxing, open port 5432, restart Minecraft, or
  expose a private AGE identity to the VPS.
- Keep `CPUQuota=50%`, `MemoryMax=1G` shared across the API, PostgreSQL and
  one-off backup; measure CPU pressure, disk latency and Paper MSPT.
- No background timer, automatic cloud backup or deletion policy until
  a successful *real* restore test and explicit approval.
- Encryption provides confidentiality but does not prove integrity of the
  restored data; test restores are mandatory before enabling personal-data sync.

## Deferred

Protected HTTPS, owner-authenticated memory CRUD, per-provider capture,
retention quotas, periodic encrypted backup, offsite redundancy and tested
rollback are later milestones. This PR only supplies a reviewed manual canary.
