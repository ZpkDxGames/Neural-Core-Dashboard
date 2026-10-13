# Neural Core · Foundation Alpha (v0.1.0)

Independent, local-first personal knowledge network for ChatGPT, Claude and Gemini conversation archives. Designed for a free Vercel dashboard and an optional private PostgreSQL backend on an existing VPS.

## What works today

- Dark, mobile-responsive Next.js dashboard.
- Interactive WebGL 3D knowledge sphere (React Three Fiber), with pan-free orbit/zoom, pause/resume, node selection, category filtering and network search for imported content.
- Clearly labeled **synthetic network** before any real data is imported.
- Local JSON file import and IndexedDB persistence; no uploads when using the dashboard's Import button.
- ChatGPT `conversations.json` parser using active conversation branches; Claude `chats.json` parser; normalized generic conversation JSON (including normalized Gemini conversations).
- Conversation library, basic topic categorization, counts, summary and context-copy functionality.
- Import/export/delete controls with opt-in local storage.
- Optional *server-to-server* `/api/v1/ingest` route with a Bearer token and PostgreSQL schema; disabled unless both environment variables are configured.
- Unit tests for archive parsing and graph integrity.

## What does not work yet

- **No live capture or browser extension** (Phase 2).
- **No Gemini Takeout parser**; no claim that Gemini exports contain complete conversations.
- **No automatic shared brain/context injection across the AI sites**.
- The local dashboard does not query PostgreSQL. The optional ingest API writes to the private database, but a full authenticated read API and owner login are pending.
- No embeddings/LLM summaries, personality inference, background jobs or semantic search yet. Categories are rule-based heuristics, not psychological traits.
- Demo graph nodes **are simulated** and never pretend to be real memories.

## Run locally

Requirements: Node.js 22+ (recommended), npm, modern WebGL-enabled browser.

```bash
npm install
npm test
npm run typecheck
npm run dev
```

Open http://localhost:3000. All client-side conversation imports remain only in that browser profile. No `.env` is required for local-first mode.

## Deploy dashboard to Vercel

1. Use the repository `ZpkDxGames/Neural-Core-Dashboard` and connect it to a new Vercel project. The repository is currently **public**; commit application source only and never conversation archives, database dumps or secrets.
2. Select Next.js and the repository root. Build command: `npm run build`.
3. Initially **do not set** `DATABASE_URL` or `CORE_INGEST_TOKEN` and **do not expose private conversation data**.
4. Open the deployed page and import your archive locally; contents stay in that browser's IndexedDB rather than Vercel storage.
5. The `.vercel.app` page itself is public unless protected; use Vercel protection and an owner login before building any server-side read/sync feature.

## Optional PostgreSQL server-to-server ingest

This is advanced scaffolding, **not cross-device dashboard sync**. Only configure when your server connectivity, authentication and TLS are correctly secured.

```bash
# On YOUR isolated PostgreSQL database, as the restricted Neural Core DB user:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/001_init.sql
```

Set `DATABASE_URL` and a new randomly generated 48+-character `CORE_INGEST_TOKEN` as Vercel **encrypted environment variables**. Never put them in `NEXT_PUBLIC_*`, git commits, URLs, browser localStorage, or extension configuration. The route supports up to 50 conversations / 500 KB per request. It is meant for a trusted server-side importer, not a public browser call. Rate limiting, verified identity, production TLS access to the private database and rotation are required before serious use.

Example normalized payload (server-side only):

```json
{"conversations":[{"id":"test-1","provider":"generic","title":"Notes","messages":[{"role":"user","text":"Investigate rendering performance"}]}]}
```

Only submit this through an authenticated backend. The database SQL defines the eventual evidence-backed knowledge graph, but the graph ingestion pipeline itself is planned.

## Privacy and security assumptions

The dashboard's **Import** file input reads JSON directly into browser memory and IndexedDB; no capture or third-party upload is performed by app code. Do not import secrets from shared computers. Browser extensions, browser backup and device compromise can still expose local data. Avoid indexing private messages until a full sign-in and retention model exists.

Vercel Functions are ephemeral; no permanent file storage should be assumed. The optional backend database is intentionally separate from Minecraft/PlexonPanel state.

## Next phases

- **Phase 1b**: owner authentication, secure backend read/ingest APIs, RLS/authorization and encryption-at-rest policy, migration scripts, backups, cloud-synchronized query views.
- **Phase 2**: permissioned browser extension, platform adapters, incremental/deduplicated capture and manual context insertion.
- **Phase 3**: local embeddings, evidence-backed nodes and edges, inference approvals, provenance, anomaly detection and scalable 3D clustering.

## Validation status

**GitHub Actions passed** dependency installation, 6 unit tests, TypeScript typechecking and `next build` on Node 22 (verification run #38408249711, 2026-10-13). Interactive browser/WebGL certification and real synchronization remain pending. See `docs/BUILD_STATUS.md`.

## Repository policy

- Source: https://github.com/ZpkDxGames/Neural-Core-Dashboard
- Release: **0.1.0-alpha.1** (experimental foundation; not build-certified).
- `main` is the reference branch. Development happens in `development/*` branches with CI and pull requests.
- The website is not an authenticated private workspace; imported data stays in the current browser only until a secure server backend exists.
