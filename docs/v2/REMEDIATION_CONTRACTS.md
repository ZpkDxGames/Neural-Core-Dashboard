# Independent audit remediation contracts — 2026-10-21

These contracts apply only to the disabled development engine. Migration 003 and its checksum are unchanged. No listener, ingress, provider, production adapter, live migration or credential is activated.

## F-01: proposal review queue

`GET /v2/memories/proposals?limit=25&status=proposed&status=conflict&type=project&cursor=...`

- `limit`: integer 1–50; defaults to 25. `status` and `type` are repeated parameters, each at most four values. Scalar `limit`/`cursor` must occur at most once; unknown query fields are rejected. No text search, offset or caller-supplied owner parameter.
- Status values: `proposed`, `conflict`, `accepted`, `rejected`. Default: `proposed` + `conflict`, so accepted/rejected history cannot crowd actionable work out of page one. Explicit history traversal is supported. Type values: `fact`, `project`, `decision`, `reference`; omitted means all types authorized by current principal scopes. Filters are intersections, never grants.
- Authorization is reloaded from SQL on every page. Owner and maintainer see their owner’s scoped proposals; other roles see only their own proposals within type scopes. Disabled credentials fail before cursor processing. No total/count query is issued.
- Ordering: immutable `(created_at ASC, proposal_id ASC)`. SQL serializes the cursor timestamp at full microsecond precision; API display timestamps may have JavaScript millisecond precision. Seek uses the SQL tuple, never an offset or a mutable status/rank.
- HMAC-SHA256 cursor binds the endpoint/version, owner, principal, credential hash, current role, sorted current scopes, normalized status/type filters and limit. Changing any of these requires a fresh traversal. Memory-list cursors cannot cross into proposals. Invalid signatures, cross-owner/principal use and changed scopes fail with `INVALID_CURSOR` (400).
- Response remains `{schemaVersion:2, confirmedAt, data:{items,nextCursor,partial}}`. End of traversal has `nextCursor:null`, `partial:false`. A SQL page fetches at most `limit+1` rows. Encoding stops below the 256 KiB response cap, reserving 4 KiB for cursor/envelope overhead; even a large proposal is individually reachable. `partial` means more currently matching rows, not a truncated item or a total estimate.
- This is a **live queue**, not a retained MVCC snapshot. Reviewing/removing an earlier row does not shift later pages. A previously historical row entering an actionable state behind the cursor requires refresh from page one. Clients refresh after review and when a traversal ends; cursors do not certify a frozen queue. Newly added rows are naturally later in chronological order. No polling is enabled in this phase.

Regression: 167 proposals with mixed states/types/authors, sub-millisecond timestamps and timestamp ties; complete traversal, default/history filters, caller visibility, revocation and scope changes, query/signature/endpoint binding, a reviewed anchor and refresh, and 180k-character payloads. HTTP tests cover repeated parameters and ambiguous queries.

## F-02: native Obsidian projection

A newly owner-verified revision emits the property below, using only the targets of its validated typed SQL relations:

```yaml
related_ids: ["33333333-3333-4333-8333-333333333333"]
aliases: ["Synthetic title"]
brain_links: ["[[33333333-3333-4333-8333-333333333333]]"]
```

The projection is a sorted, deduplicated list of quoted UUID wikilinks. Canonical UUID filenames remain stable; display titles remain in `aliases`. Multiple typed edges to one target produce one native graph connection. The relation type, evidence ordinal, confidence, source revision and verified owner remain authoritative **only in SQL**. An unverified target is not promoted by a source’s link. Obsidian’s graph cannot express all those semantics or certify approval.

`serializeNote` defaults to no approved projection. Only the authenticated `verify` decision supplies `approvedRelations:true`. `publish-unverified` emits an empty projection. Source refs, note body, stable identity and aliases are otherwise preserved. No writeback/backfill of immutable historical revisions occurs; they acquire projections only through a new explicitly reviewed revision.

Parser restrictions remain: small JSON-compatible YAML subset; no anchors, aliases, objects, unknown/duplicate keys or executable tags. Optional `brain_links` is at most 32 strings, each exactly `[[UUID]]`, unique and present in `related_ids`; embedding, aliases, relative paths, schemes, headings and arbitrary targets in this generated property fail closed. Old files without the new key remain readable.

All file metadata remains self-reported. Reconciliation proposes only the edited body while copying the **published SQL payload’s** evidence and typed relations. Forged valid `brain_links`, `related_ids`, `source_refs`, aliases or `state:verified`, and arbitrary manual body wikilinks, never add SQL edges or grant verification. Following owner review regenerates the projection from SQL; edits to property-only metadata do not become trusted provenance. A malicious body link may appear in Obsidian’s own graph, which is an untrusted editor view, without appearing as an approved engine relation.

Format references checked 2026-10-21: [Obsidian Properties](https://obsidian.md/help/properties), especially quoted links in list properties, and [Graph view](https://obsidian.md/help/plugins/graph). Automated tests verify bytes, strict parsing, round trips and SQL reconciliation. **Real Obsidian desktop visibility is uncertified**: no desktop session is available here. Before staging qualification, open a synthetic two-note vault in desktop Obsidian with community plugins/sync disabled; inspect Properties, outgoing links, local/global graph and title aliases; edit/reconcile/approve and confirm a forged body link never becomes a verified engine edge. Record version and screenshots with synthetic data only.

## F-03: bounded offline checkpoints; 100k explicitly blocked

`checkpoint(...,{snapshotId,quiesced:true})` now authenticates export before reading files, requires an unrestricted owner export scope, and reads the authoritative note ledger rather than a possibly incomplete search index. SQL reads are capped at 10,001 rows; unresolved outbox detection uses `LIMIT 1`. Live notes plus tombstones must total at most **10,000**.

A single `opendir` walk inventories at most **10,000 directory entries**, sorts their safe Markdown filenames once and caps estimated filename allocation at 4 MiB. Files are read and hashed one at a time. Every live ledger record must have its canonical file, acknowledged revision and hash; every file must have a live ledger record. Tombstoned files are rejected explicitly. Tombstone IDs/revisions are included and structurally validated, with duplicate/overlapping live/dead IDs rejected. Manifest JSON is capped at 4 MiB. These are allocation/input caps, not a portable process RSS guarantee; Node, SQL buffers and serialization also consume memory.

Quiescence is an explicit **operator attestation**, not an automatic lock. All writers, workers and editors must be stopped for the entire operation and a matching DB snapshot obtained separately. Temporary publications, changed directory identity/timestamps or changed ledger rows/revocation are detected and abort the run. These drift checks cannot prove absence of an in-place edit after its file hash was read. The manifest hash proves consistency relative to a trusted expected manifest; it is not an author signature or an encrypted backup.

Oversize data fails with `CHECKPOINT_ENTRY_BUDGET` (413); allocation caps fail with `CHECKPOINT_MEMORY_BUDGET`; missing quiescence fails with `QUIESCED_SNAPSHOT_REQUIRED`; detected drift fails with `VAULT_NOT_QUIESCENT` (409). There is no fallback to repeated paged scans and no watcher is introduced. The existing small-page `FileVault.list` remains bounded per call but must not be used for whole-vault certification.

**100k-file checkpoints, paired encrypted recovery and shared-VPS capacity remain blocked.** The physical benchmark measures 1k/10k full checkpoints and creates an actual 100k-file directory to verify early refusal. Its ledger is simulated to isolate physical IO; it does not measure SQL, Oracle interference or encrypted recovery. Before raising the cap, implement an offline sorted external merge/streamed manifest with bounded run size, file descriptors, bytes, deadline and cancellation; use an operator-controlled immutable filesystem/DB snapshot pair; then measure complete 100k-file hashing, orphan/tombstone reconciliation, restore and process/cgroup CPU/IO/WAL under separately approved conditions. Do not replace this gate with an uncapped file watcher.
