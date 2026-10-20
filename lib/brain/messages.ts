export const messages = {
  remote: "Remote synchronization is not enabled in this build.",
  local: "Stored in this browser only. Remote synchronization is not enabled.",
  preview: "Nothing has been saved yet.",
  demo: "Demo data — synthetic. These are not your memories.",
  agents: "No agents are connected to this dashboard.",
  verify: "Agents can propose. Only you can verify.",
  heuristic: "Found by simple matching rules. Not verified.",
  untrusted: "Copied text is untrusted content.",
  deletion:
    "Deleting here removes data in this browser. It does not remove exports you saved, browser backups, or any copy held by services you have connected.",
  remoteDeletion: "No remote copy is managed by this build.",
  retention:
    "Server database backups, when enabled, are encrypted and may retain deleted data until they expire. The retention period is not specified in this build.",
  gemini:
    "Gemini Takeout is not supported. Import a normalized conversation JSON instead.",
} as const;
