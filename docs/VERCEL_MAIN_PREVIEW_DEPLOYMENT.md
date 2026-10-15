# Vercel deployment plan: `main` + `preview`

> 2026-10-15: the owner has configured authentication on the existing branch-scoped Preview environment. See [authentication stabilization audit](PHASE_1B_AUTH_STABILIZATION_AUDIT_2026-10-15.md) for current evidence, limits and certification. The original OFF-by-default preparation guidance below remains the safe baseline for new deployments.

## Current deployment mapping

| Git branch | Vercel environment | Role |
|---|---|---|
| `main` | **Production** | Original stable baseline, unchanged by this preparation |
| `preview` | **Preview** | Snapshot of the latest approved Phase 1b development code, but **authentication OFF** and remote sync OFF |

The engineering branch `development/persistent-memory-phase-1b` and draft PR #6 are retained for ongoing reviews and source-level changes; do not delete their history or merge the incomplete feature into `main`. Keep PRs #4 and #5 unchanged. Only `main` and `preview` are designated as user-facing deployment branches.

### Vercel project settings

- Existing project: `neural-core-dashboard`, linked to `ZpkDxGames/Neural-Core-Dashboard`.
- Framework: **Next.js**, root directory **`./`** (repository root), package manager **npm**, Node.js **22.x** (or a supported version >= 20.9); install **`npm ci`**, build **`npm run build`**.
- **Production branch: `main`** (do not move this to `preview`). Automatically built Git pushes to `preview` should receive Vercel's **Preview** target; manually specify **Preview**, not Production.
- In Vercel's **Create Deployment → Branch, Commit, or URL** field, type only **`preview`** or the exact commit SHA (not `https://github.com/.../tree/preview`). Click **Create Preview Deployment**.
- Optionally enable Vercel Authentication for Preview under **Project Settings → Deployment Protection** before sharing the preview URL. Avoid embedding any credentials, real archive content, or tokens in the repo.
- Obtain the actual preview URL from the successful Vercel deployment's **Domains** tab. Do not invent or assume the hostname; Google's later redirect URI must use the exact approved HTTPS origin.

### Configuration boundaries

The server's persistent-memory endpoints are disabled by default; Vercel does **not** receive `DATABASE_URL`, an Oracle server token, the VPS SSH key or raw private conversation data. `NCORE_OWNER_AUTH_ENABLED` is OFF by default, so `/api/auth/owner/*` fails closed until a separate staging configuration is explicitly approved. No Upstash URL/token, Google client secret, Google owner `sub`, or CSRF signing key is committed.

**Upstash Redis Free** has been approved for **session-only** storage; the isolated database has been created by the owner. This approval does not authorize entering tokens into this public repository, connecting to production, or modifying Vercel production environment variables. Use the **REST** URL/token, not TCP credentials, when a private staging configuration is approved.

GitHub CI runs synthetic offline tests, PostgreSQL migration/rollback/restore checks, typecheck, build and Next auth-disabled route smoke on `main`, `preview`, `development/**` and PRs. A green GitHub build establishes deployability of source; it does not certify Google OAuth, Vercel hosting, or database connectivity.

### Promotion procedure

1. Develop and run all tests on `development/persistent-memory-phase-1b`.
2. Advance `preview` via a **fast-forward** to the approved and tested development commit (no force push).
3. Verify Vercel Preview deployment and manual browser checks; keep auth/sync disabled pending separate consent.
4. After approved real Google OAuth staging tests, threat review, explicit ingress/sync approval and full rollback verification, merge the relevant stacked PRs into `main` under a separate production release decision.

### Troubleshooting: Create Deployment rejects a branch

The text entry is a Git **ref**: paste `preview`, not a URL containing `/tree/`. If Vercel still reports that the ref cannot be found, verify GitHub's `preview` branch exists, ensure the Vercel GitHub app is installed for the correct repository, and refresh Vercel's Git connection. For missing team access, reauthorize the Vercel connection for the **actual owning team** instead of switching to a different account.

### No changes authorized by this procedure

Do not merge Phase 1b to production solely because tests pass. Do not modify DNS, Caddy, Oracle VPS services, PostgreSQL data, Minecraft, PlexonPanel or any deployment secrets. Do not enable remote sync.
