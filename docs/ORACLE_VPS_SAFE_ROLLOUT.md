# Neural Core — Oracle VPS safety gate

Status: **planning / read-only inventory only**. No installation or modification to a running server is authorized by this document.

## Current information (unverified runtime assumptions)

- Oracle Ampere VPS previously described as **4 OCPUs**, **24 GiB RAM**, **150 GiB disk**.
- The current Minecraft server has an **8 GiB Java heap allocation**, not a guarantee that its total resident memory is 8 GiB.
- Disk is approximately **25% used**, based on user report. Verify available inodes, filesystem and actual free bytes.
- Other workloads may include a second Minecraft instance, PlexonPanel Host/Relay, Caddy, backups and Discord/voice services. Do not assume they are stopped.

## Safety assessment

Risk is **low for a resource-capped metadata database and HTTP API** after a real peak-hour inventory. Risk can rise for:
- any CPU-heavy local model or mass embedding task (do not run these on the VPS initially);
- unlimited database cache/connections or background batch imports;
- storage growth due to unbounded conversation retention, PostgreSQL WAL, backups and logs;
- Java heap vs. real process RSS and concurrent Paper servers;
- Minecraft save/backup peaks and Oracle CPU contention.

The VPS must prioritize Minecraft. No change to an existing Paper, PlexonPanel, relay, Caddy or backup unit is permitted in the first rollout.

## Gate 0: read-only inventory (no sudo required)

Run during a typical busy period and ideally again during a backup:
```bash
git clone https://github.com/ZpkDxGames/Neural-Core-Dashboard.git
cd Neural-Core-Dashboard
git checkout ops/oracle-vps-capacity-gate
bash ops/audit-vps-capacity.sh
```
The script does **not** write files, expose credentials, alter services, connect to networks, or read application configuration. It reports free memory, process RSS, CPU and memory pressure, disk usage and matching service names. Review output before sharing and redact anything you consider private.

Minimum acceptance considerations before any install:
1. Memory headroom remains several GiB **after accounting for all Minecraft instances**, especially at peak or backup periods. A cautious starting threshold is **at least 4 GiB MemAvailable** before adding a capped 1 GiB stack.
2. Tick health (TPS/MSPT, including p95 during peak) is already stable. Record a baseline before any change.
3. No sustained host CPU pressure; confirm that Paper's performance is not already saturated or limited by the four OCPUs.
4. No ongoing disk, swap or OOM issues and at least 20 GiB unreserved disk space after anticipated Minecraft growth and backup retention.
5. No existing service uses the prospective Neural Core listen addresses, users, or directories; discover instead of guessing.

These are operational gates, not guarantees of performance.

## Gate 1: isolated service design (NOT active)

- Deploy a dedicated PostgreSQL cluster and a dedicated ingestion API under `neural-core.slice`, not the existing PlexonPanel or Minecraft units.
- A template `ops/systemd/neural-core.slice` sets a **combined** `MemoryMax=1G`, `MemoryHigh=768M`, `CPUQuota=50%` (half of one CPU), low scheduler/IO weights, and task limits.
- **Important:** These caps work only when **all Neural Core processes, including PostgreSQL**, explicitly run in the slice. A PostgreSQL service outside the slice is *not* covered. Do not install or enable the slice yet.
- Configure small database cache, conservative connection limits, bounded WAL/log rotation and retention. Begin with a disk **budget target** of 5 GiB; this is not an enforced quota without a proper filesystem limit.
- No unrestricted background indexing or model inference on the VPS.
- Run persistent services as dedicated non-root identities with filesystem ownership scoped to their own directories.
- Keep PostgreSQL bound to `127.0.0.1` or a private Unix socket. **Never expose port 5432 to the Internet.**
- Vercel cannot access a loopback-only VPS DB directly. Use a separately authenticated HTTPS API with TLS through a carefully reviewed Caddy route, or a secured tunnel. Do not put private DB credentials in client bundles.
- No public read/sync routes or server-side personal conversation import until actual owner authentication, access controls, rate limiting, CSRF/origin handling and delete/export paths are tested. A single bearer token is not a user login system.
- Ensure private backups are encrypted, retention-bounded and restorable; keep data isolated from Minecraft backups.

## Gate 2: measured canary (later, approval required)

1. Run database and API only, idle, with external ingestion disabled.
2. Measure 30 minutes idle and 30 minutes around Minecraft peak usage; repeat during backup.
3. Verify host MemAvailable, swapping, CPU pressure, PostgreSQL responsiveness, IO latency and Paper MSPT/TPS against the recorded baseline.
4. Generate a small synthetic import from the authorized machine; never copy real conversation archives into Git or logs.
5. Verify restart/stop, shutdown safety, backup restore and that cgroup caps isolate a simulated runaway service.
6. If Paper tick health degrades materially, stop **only Neural Core**; do not restart Minecraft or disable an existing service.

## What this branch does

This branch ships **documentation**, a **read-only audit script**, and an **inactive systemd resource-envelope template**. It does not install PostgreSQL, deploy a backend, change firewall/Caddy, start services, or connect to the user's VPS.

## Later dependencies

A private backend, authorization protocol, HTTPS origin, encryption/restore plan, owner UI and validated cross-provider capture policies must be implemented separately. The existing public Vercel dashboard remains local-first until those gates are met.
