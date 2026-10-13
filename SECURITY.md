# Security and privacy policy

This is a public source-code repository for a **local-first personal knowledge dashboard**. Do **not** open issues or commits containing conversation archives, screenshots of confidential chats, credentials, tokens, or personal memory data.

The alpha dashboard offers no owner authentication or remote personal data readback. Importing conversation JSON through the UI stores content in the current browser's IndexedDB, **not** in the GitHub repository or Vercel function storage. The web URL itself is public unless separately protected.

The optional `/api/v1/ingest` endpoint is **disabled** unless configured. Never configure its token or `DATABASE_URL` until authentication, rate limiting, TLS connectivity, least-privilege database access and recovery are reviewed. No server sync is enabled during the alpha bootstrap.

Do not disclose suspected security vulnerabilities in a public issue if they include sensitive details.
