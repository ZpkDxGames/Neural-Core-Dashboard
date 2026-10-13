# Versioning and branches

- Current alpha: `0.1.0-alpha.1` — development foundation.
- `main` remains the authoritative branch for released source, initially populated with alpha scaffolding.
- All subsequent feature changes should use `development/<topic>` branches with draft PRs and CI, and be merged after review.
- Use SemVer prerelease versions until production gates pass. Do **not** label alpha builds as stable.
- Do not tag a GitHub release until install, typecheck, unit tests, Next.js build and browser review are green.
- Keep user conversations, tokens and database contents out of GitHub at all times.
