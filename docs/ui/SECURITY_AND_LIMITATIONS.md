# Security review and certification boundaries

The development review checks inputs, authority and acknowledgement boundaries. It is not an independent security audit.

- Markdown/agent/import text is untrusted. The renderer creates React nodes from an AST allowlist, blocks raw HTML, images/transclusion and unsafe links, neutralizes direction controls, and bounds bytes/nodes/depth/tables/links. External navigation requires confirmation. The 24-case browser corpus checks DOM attributes, markup, false verification and network requests.
- Owner identity behavior is preserved. CSRF/session tokens are obtained only through the existing server routes. Browser bundles were scanned for the existing secret/allowlist identifiers; no match was found. Signing in never changes the remote consent or connection state.
- Real remote methods are unavailable and perform zero I/O. No database credential, canary token, internal URL or real provider identity is introduced in the client. No new third-party network host is used.
- Import previews do not store data. Storage and deletion success follow IndexedDB transaction completion. A failed or bounded export cannot claim a complete archive. Historical exports/browser backups remain separate deletion boundaries.
- Backend rights are revalidated by principal, owner, role and type scopes. Contributors cannot verify or read the owner-only registry, cross-owner content or other agents' proposals. Proof issuance/identity provisioning is not exposed to agents or the browser. Immutable revisions and evidence references are enforced independently of frontmatter.
- SQL and files form a recoverable outbox saga, not an impossible cross-filesystem SQL transaction. The private vault requires an exclusive publication writer. A hostile local writer racing the final hash check/rename is outside the filesystem CAS guarantee; do not grant such writers production access without reviewing the concurrency policy.

## Remaining certification and activation gates

1. An independent reviewer must inspect exact PR commits and the security boundaries. This implementation pass does not count as independent review.
2. An owner-approved staging composition root, private browser ingress, owner proof/step-up issuer, grant administration and real provider adapters are not activated. Current review/draft UI therefore cannot operate real server memories.
3. Live Google owner login, deployed CSRF/session rotation, private HTTPS ingress and current deployment source remain unverified.
4. Encrypted paired PostgreSQL/vault backup restore, key custody, retention and historical revision purge need owner policy and staging verification. Tests verify SQL restore and manifest/hash/tombstone behavior; they do not certify an encrypted live pair.
5. Native PostgreSQL concurrency is covered in disposable CI; Oracle resource limits, WAL growth, 100k physical Markdown files, filesystem watcher pressure and Minecraft/PlexonPanel impact are not certified. No live load was generated.
6. Software Chromium graph lifecycle, keyboard checks, forced colors and axe are verified. Hardware GPU drivers, mobile Safari/Android, battery use, color-vision users, NVDA/JAWS/VoiceOver/TalkBack, and field Web Vitals remain unverified. A 640px viewport is an equivalent reflow check, not a real OS/browser 200% zoom certification.
7. No embeddings/vector ranking, automatic contradiction adjudication, live capture or automatic context injection is claimed. Explicit evidence-bearing `contradicts` edges and owner-controlled consolidation are supported.
8. The vault is private by owner and uses application role/scope enforcement. This is not a claim of adversarial shared-database tenant isolation or a complete RLS security boundary.

Production rollout, migration, secret changes, public exposure, live agent synchronization and main merges all require separate owner authorization. Keep this candidate disabled until those gates are reviewed.
