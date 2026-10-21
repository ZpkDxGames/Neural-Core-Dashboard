# Verified legacy parity

The PR 6 source union contains exactly `overview`, `network`, `memories`, `insights`, `sources`, `settings`. The existing root actually recognized settings/auth query markers; the V2 resolver now maps all six explicitly and preserves unrelated query parameters. Unknown view values show a moved-view notice. The checked-in source-derived inventory and mandatory 15-entry manifest are in `tests/parity/`. No existing browser test is skipped.

| ID | Preserved behavior | V2 destination / evidence |
| --- | --- | --- |
| F01 | ChatGPT active branch, Claude blocks, normalized Generic/Gemini | Sources importer; original parser tests + browser formats |
| F02 | Preview before persistent write; explicit storage consent | Sources preview/consent, zero external requests |
| F03 | Stable provider IDs, IndexedDB/export/delete | J1 export round trip + exact transaction-confirmed deletion |
| F04 | Conversation list/detail | Library, 50 DOM rows with 5,000 sources |
| F05 | Cited context clipboard | Library reader; source/message IDs and untrusted-content warning |
| F06 | Actual counts | Overview browser envelope; unavailable remote tiles |
| F07 | Rule-based categories | Same classifier; explicit rule-based badges |
| F08 | Sphere, selection, search/filter, zoom, orbit, pause | Lazy vanilla Three sphere; 2D default; DOM alternatives; software lifecycle test |
| F09 | Labelled synthetic graph | Explicit demo opt-in and persistent banner |
| F10 | OIDC session/loading/error/logout/retry/cross-tab | Existing OwnerIdentitySettings logic and nine regression tests |
| F11 | Remote synchronization disabled | Shell/settings remain Local only; focusable controls explain why |
| F12 | Settings deep link | Resolver canonicalizes to /settings |
| F13 | All six view values | Legacy inventory plus browser iteration |
| F14 | PR2 30-topic lexical concepts/citations | Explicit port from sibling PR2, five tests, exact source excerpts in inspector |
| F15 | Existing suites | Retained original behavioral assertions and CI steps |

PR2 is not an ancestor of PR6. Only its concept catalog/types/graph/tests were ported, with bounded-index TypeScript annotations. No sibling page/auth code was merged. Original parser/storage schema and sync policy remain compatible. Added IndexedDB helpers keep version 1/store name/key unchanged and confirm writes on `transaction.oncomplete`. Reads stop at 50,000 records or 32 MiB of estimated string content; partial counts/search are visibly labelled and partial export is refused.

The sole existing auth-browser expectation change is the wrong-account callback's canonical `/settings` URL. All its rejection and URL-marker-removal assertions remain. The unchanged server dispatcher extraction belongs to the backend base, documented separately. The owner widget source itself is unchanged.

Native hardware sphere rendering and live Google login are separate certification gates; synthetic browser tests do not certify either.
