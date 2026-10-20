# Dashboard architecture

Server routes select the page/query state and a client provider holds the existing browser archive, bounded temporary imports, preferences and unsent drafts. Client pages are split by section; the Three renderer is a separate dynamic chunk. Ports expose typed data envelopes with local/demo/remote provenance; unavailable is not a successful empty result.

`lib/brain` contains framework-independent connection derivation, status registry, link policy, AST parsing, graph projection/layout/scene, spatial index, lifecycle ownership and acknowledgement coordinators. `components/brain` owns interaction and presentation. The independent `backend/v2` engine never imports dashboard code.

Workers have bounded inputs, cleanup and deadlines. Search yields approximately every 6 ms and discards stale generations. Archive parsing is capped at 32 MiB/50k records; browser reads at 50k/32 MiB estimated strings. Markdown preview caps bytes/nodes/depth/links/tables and never transcludes another note. Graph construction caps 1,200 nodes; overview shows loaded vs total and focused neighborhoods cap 300 nodes. Backend caps and privacy are enforced independently.

Raw archives stay in IndexedDB only after consent. Preferences contain no content or identity. No remote adapter polls, sends content or assumes an owner session. The owner sign-in widget retains its original route calls and CSRF/session behavior.

Future staging work must map the tested internal V2 responses to UI envelopes, establish private ingress, reauthenticate owner decisions, supply revision-scoped proofs, and certify consent/deletion/restore behavior end to end. None is enabled by this development candidate.
