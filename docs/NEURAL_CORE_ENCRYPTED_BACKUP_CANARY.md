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

## 4 — Restore into an isolated test database, not production

Move only the encrypted `.dump.age` and matching `.sha256` files to a
trusted workstation with the private AGE identity. Verify their checksum
locally. Prepare an empty disposable `neuralcore_restore_check` database
on the VPS, **stopping if it already exists**:

```bash
sudo -u postgres psql -Atqc \
  "SELECT 1 FROM pg_database WHERE datname='neuralcore_restore_check';"
# Only if the query emitted NO ROWS:
sudo -u postgres createdb -O postgres neuralcore_restore_check
```

On a trusted Linux/macOS/WSL shell where `age`, the encrypted dump and
private identity reside, decrypt **in memory only** and transfer the plaintext
stream over authenticated SSH into the disposable database:

```bash
set -o pipefail
age -d -i ./neuralcore-recovery-identity.txt ./neuralcore-BACKUP.dump.age \
  | ssh -T ubuntu@YOUR_VPS_HOST \
    'sudo -n -u postgres pg_restore --exit-on-error --no-owner --no-acl \
      --dbname=neuralcore_restore_check'
```

This requires passwordless `sudo -n -u postgres` on the authorized SSH
account; if not available, **stop and use an approved alternative** rather
than placing the private identity on the VPS. TLS or plain TCP PostgreSQL
access is never needed. The unencrypted stream lives only inside the SSH
channel and processes, not as a disk file.

Validate schema/table counts and (after real data exists) record counts and
a representative query against the **test database**. Never restore into
`neuralcore`, overwrite it or change the running API.

Keep the disposable test database until inspection is complete; cleanup is
a separate manual, explicitly reviewed action.

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
