# Neural Core — private Oracle VPS canary deployment

**Stage:** CANARY / manual deployment. **Not** a production memory-sync release.

The owner's read-only VPS preflight showed: ~19.7 GiB memory available, 117 GB disk free, negligible pressure, Caddy/PlexonPanel running, TonimSMP Paper running, PlexonCraft Minecraft inactive, no running PostgreSQL service, and no listener on TCP **4765** or **5432**. This is a time-specific snapshot; reconfirm before installing.

## Scope and architecture

- A new PostgreSQL cluster and a Node.js backend. No paid AI APIs and **no LLM inference**.
- PostgreSQL **Unix socket only**, not publicly listening on TCP 5432. A new database `neuralcore` (no user data yet).
- HTTP API **127.0.0.1:4765 only**. `GET /healthz` checks the process; `GET /readyz` requires a random bearer token and runs `SELECT 1`. All memory routes return 404.
- A dedicated Unix user `neuralcore_api` mapped to an equally named **unprivileged** PostgreSQL role through peer authentication.
- Shared `neural-core.slice` for both PostgreSQL and API with `CPUQuota=50%` (**half of one logical CPU, not half the entire host**), `MemoryMax=1G`, low I/O and CPU weights. The API has its own 320 MiB cap, PostgreSQL its own 768 MiB cap, but the shared slice enforces the combined total.
- No modification to Minecraft, PlexonPanel, Caddy, firewall, public DNS, or Vercel production.

**Stop and ask before proceeding if** PostgreSQL already exists, the OS is not Ubuntu with systemd/apt, the cluster name is not what you expect, CPU/RAM headroom is substantially lower, or you see unexpected listeners on either port.

## A. Baseline (read-only)

Run on your Oracle VPS over SSH. Record Minecraft TPS and MSPT from PlexonPanel both before and after installation, ideally including a busy period.

```bash
free -h
uptime
df -h /
cat /proc/pressure/{cpu,memory,io}
command -v node
node -v
command -v npm
test -x /usr/bin/node && /usr/bin/node -v
systemctl is-active minecraft@tonimsmp.service
systemctl is-active plexonpanel-relay.service
ss -H -ltn | awk '{print $4}' | grep -E '(^|:)(4765|5432)$' || true
```

The supported runtime for this canary is **Node 22+ at `/usr/bin/node`**. If Node is only installed through `nvm`, stop and adapt the service with an audited system-managed Node path; do not change Minecraft's Java or Node settings.

## B. Source checkout (read-only to live services)

```bash
git clone --depth 1 --branch ops/private-core-local-canary \
  https://github.com/ZpkDxGames/Neural-Core-Dashboard.git \
  /tmp/neural-core-canary
cd /tmp/neural-core-canary
node --test backend/core-server.test.mjs
node --check backend/server.mjs
```


## C. Install PostgreSQL during a quiet server period

First verify again that no PostgreSQL database is used by another application. Use the list-only service-restart mode (`NEEDRESTART_MODE=l`) to avoid automatically restarting unrelated daemons; review any prompts and decline restarts of Minecraft, PlexonPanel and Caddy. This creates a new OS package-managed service and may briefly start the default cluster **before** its resource limits are applied; the server has adequate measured headroom but this is not zero-risk. Don't interrupt an in-progress Minecraft world backup.

```bash
sudo apt-get update
sudo env NEEDRESTART_MODE=l apt-get install -y postgresql
pg_lsclusters
```

**STOP HERE** and examine `pg_lsclusters`. Proceed only with a **new dedicated `main` cluster** that no other application uses. In the remaining commands, replace `16` with the **version actually printed**. The examples assume Ubuntu 24.04 / PostgreSQL 16; do not blindly copy the number on another distribution.

```bash
PG_VERSION=16                # replace with the observed version
PG_UNIT="postgresql@${PG_VERSION}-main.service"
sudo systemctl stop "$PG_UNIT"
sudo install -m 0644 ops/systemd/neural-core.slice /etc/systemd/system/neural-core.slice
sudo install -d -m 0755 "/etc/systemd/system/${PG_UNIT}.d"
sudo install -m 0644 ops/systemd/postgresql-neural-core.override.conf \
  "/etc/systemd/system/${PG_UNIT}.d/60-neural-core.conf"
sudo systemctl daemon-reload
sudo systemctl start "$PG_UNIT"
systemctl show "$PG_UNIT" -p Slice -p MemoryMax -p ActiveState
```

If the output doesn't include `Slice=neural-core.slice`, **stop**: the database isn't constrained as expected. Never edit the global `postgresql@.service` template because other PostgreSQL clusters might eventually exist.

Make **only this PostgreSQL cluster** Unix-socket-only and conservative:

```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET listen_addresses = '';"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET shared_buffers = '64MB';"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET max_connections = '15';"
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET max_wal_size = '256MB';"
sudo systemctl restart "$PG_UNIT"
pg_lsclusters
ss -H -ltn | awk '{print $4}' | grep -E '(^|:)5432$' \
  && echo "STOP: PostgreSQL is unexpectedly listening on TCP" \
  || echo "PASS: no PostgreSQL TCP listener detected"
```

Do not proceed if PostgreSQL is unexpectedly listening on TCP.

## D. Provision dedicated unprivileged identity, empty database, and source schema

```bash
sudo useradd --system --user-group \
  --home-dir /var/lib/neural-core-api --shell /usr/sbin/nologin neuralcore_api
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE neuralcore_api LOGIN;"
sudo -u postgres createdb --owner=postgres neuralcore
sudo -u postgres psql -d neuralcore -v ON_ERROR_STOP=1 -f db/001_init.sql
sudo -u postgres psql -d neuralcore -v ON_ERROR_STOP=1 \
  -c "REVOKE ALL ON DATABASE neuralcore FROM PUBLIC;"
sudo -u postgres psql -d neuralcore -v ON_ERROR_STOP=1 \
  -c "REVOKE CREATE ON SCHEMA public FROM PUBLIC;"
sudo -u postgres psql -d neuralcore -v ON_ERROR_STOP=1 \
  -c "GRANT CONNECT ON DATABASE neuralcore TO neuralcore_api;"
sudo -u neuralcore_api psql -h /var/run/postgresql \
  -p 5432 -U neuralcore_api -d neuralcore -Atqc 'SELECT 1'
```

Expected final output: `1`. If peer authentication fails, **do not** weaken `pg_hba.conf` to `trust` or open TCP. Diagnose why the OS username and DB username don't match. The canary role has database CONNECT only, no tables/memory read or write privileges.

## E. Install Node.js API and token file (local-only)

Confirm again that `/usr/bin/node` is Node 22+. Install only the small isolated backend rather than the Next.js dashboard.

```bash
STAGING="$(mktemp -d /tmp/neural-core-api.XXXXXXXX)"
trap 'rm -rf "$STAGING"' EXIT
cp backend/package.json backend/core-server.mjs backend/server.mjs \
  backend/core-server.test.mjs "$STAGING/"
npm --prefix "$STAGING" install --omit=dev --ignore-scripts --no-audit --no-fund
node --test "$STAGING/core-server.test.mjs"

sudo install -d -m 0755 /opt/neural-core-api
sudo cp -a "$STAGING/." /opt/neural-core-api/
sudo chown -R root:root /opt/neural-core-api

# CRITICAL: mktemp creates a 0700 staging directory; cp -a can propagate 0700
# onto the *destination directory* despite install -d having set 0755 earlier.
# Fix only the service-code directory. Do not alter token directory permissions.
sudo chmod 0755 /opt/neural-core-api
sudo -u neuralcore_api sh -c \
  'cd /opt/neural-core-api && /usr/bin/node --check server.mjs'
sudo install -d -o root -g neuralcore_api -m 0750 /etc/neural-core
sudo sh -c 'umask 027; openssl rand -hex 48 > /etc/neural-core/api.token'
sudo chown root:neuralcore_api /etc/neural-core/api.token
sudo chmod 0640 /etc/neural-core/api.token
sudo install -m 0644 ops/systemd/neural-core-api.service \
  /etc/systemd/system/neural-core-api.service
sudo systemctl daemon-reload
sudo systemctl start neural-core-api.service
```

Do not print, paste, log, commit or upload `/etc/neural-core/api.token`; it is a private secret. The canary source pins the direct `pg` version, but a committed lockfile is still required before expanding from canary to production synchronization.

## Recovery: systemd 200/CHDIR from staged installation

If `journalctl -u neural-core-api.service` reports `status=200/CHDIR` and
`Changing to the requested working directory failed: Permission denied`,
**stop the restart loop** rather than changing security sandbox settings:

```bash
sudo systemctl stop neural-core-api.service
namei -l /opt/neural-core-api
sudo stat -c '%a %U:%G %n' /opt /opt/neural-core-api
sudo chmod 0755 /opt/neural-core-api
sudo -u neuralcore_api sh -c \
  'cd /opt/neural-core-api && /usr/bin/node --check server.mjs'
sudo systemctl reset-failed neural-core-api.service
sudo systemctl start neural-core-api.service
```

Confirm the observed cause before applying the `chmod` and **stop if the
service-user check still fails**. Never use `chmod -R 777`, widen
`/etc/neural-core` or disable `ProtectSystem`/`ProtectHome` as a shortcut.
The token file remains private, root-owned and group-readable only.

## F. Verify both cgroup membership and HTTP behavior

```bash
systemctl is-active neural-core-api.service "$PG_UNIT"
systemctl show neural-core-api.service -p Slice -p MemoryMax -p MemoryCurrent
systemctl show "$PG_UNIT" -p Slice -p MemoryMax -p MemoryCurrent
systemctl show neural-core.slice -p CPUQuotaPerSecUSec -p MemoryMax -p MemoryCurrent
# Type=simple reports active once Node starts, not once Node has bound its socket.
# A brief ECONNREFUSED immediately after start can be a startup race.
sudo ss -ltnp '( sport = :4765 )'
curl --noproxy '*' --retry 5 --retry-connrefused --retry-delay 1 \
  --max-time 5 --fail --silent --show-error http://127.0.0.1:4765/healthz
curl --noproxy '*' --silent -o /dev/null \
  -w "unauthorized readiness HTTP %{http_code}\n" \
  http://127.0.0.1:4765/readyz
```


If `/healthz` fails after the retry window but `systemctl is-active` prints
`active`, do not infer that the API is healthy. Inspect the live socket and
the main PID rather than modifying database or token permissions:

```bash
sudo ss -ltnp '( sport = :4765 )'
systemctl show neural-core-api.service -p MainPID -p NRestarts -p ActiveState -p SubState -p Result
sudo journalctl -u neural-core-api.service -n 30 --no-pager -o short-iso
```

Avoid logging secrets; do not rerun installation or regenerate the token.

Expected unauthorized readiness is **HTTP 401**. To verify authorized readiness, read the secret directly in a temporary root-run Node process; this does **not** place it in curl argv, shell history, or logs:

```bash
sudo /usr/bin/node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
const token = readFileSync('/etc/neural-core/api.token','utf8').trim();
const response = await fetch('http://127.0.0.1:4765/readyz', {
  headers: { authorization: 'Bearer ' + token },
  signal: AbortSignal.timeout(4000)
});
console.log('Authenticated readiness HTTP', response.status);
console.log(await response.text());
if (response.status !== 200) process.exitCode = 1;
NODE
```

Check `ss -ltn` to verify port 4765 listens **only** on 127.0.0.1, and confirm no TCP listener on port 5432. The existing 8787 (PlexonPanel Relay), 2019 (Caddy), 80/443, and Minecraft listener addresses must remain unchanged. Compare TPS/MSPT and pressure metrics to baseline during normal load and a backup.

**Resource limit verification is essential:** if either backend process is outside `neural-core.slice`, stop its service immediately; declaring the slice file alone is insufficient.

## G. Recovery/rollback — leave Minecraft untouched

Stop only Neural Core:

```bash
sudo systemctl disable --now neural-core-api.service
sudo systemctl stop "$PG_UNIT"
```

This will make Neural Core unavailable but keeps the database files in place for an orderly investigation or restore. **Never** stop, restart, alter permissions for, or delete `minecraft@*.service`, `plexonpanel-*.service`, `caddy.service` or their data as part of this rollback.

## Deferred gates

- Real personal conversation ingestion and sync are **disabled**. A Vercel frontend may not access loopback services.
- No public Caddy route, firewall opening, DNS change or Vercel environment variable changes until a reviewed owner-authenticated HTTPS design exists.
- Add exact lockfiles, source-based migration versioning, encrypted backup and restore certification, retention quotas, API abuse controls, and multi-provider deletion/export before enabling sync.
- This canary's successful health/readiness check does **not** certify Minecraft performance or a finished AI brain.
