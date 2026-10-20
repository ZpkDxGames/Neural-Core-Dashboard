# Route export compatibility

The supported Webpack build uncovered a preexisting invalid Next route export: `dispatch` is a testable helper, not an allowed App Router route export. The dispatcher was moved unchanged into `lib/auth/owner-dispatch.ts`; the route now exports only runtime/dynamic plus GET and POST. Request handling, diagnostics, OIDC, CSRF, cookies, configuration and HTTP responses are unchanged. Tests import the helper from its new internal location and retain all behavioral assertions.

SHA-256 of the moved dispatcher/methods text before and after extraction: `816aaf0b4d47bdae3b9c9b64d749cc46e990c919910d81599e4ef44bfed8efa9`. This is a source-only compatibility fix in the backend workstream; no credentials or deployed routes were changed.
