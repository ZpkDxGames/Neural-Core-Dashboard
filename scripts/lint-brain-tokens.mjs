import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
const tokens = new Set(
  [
    ...readFileSync("app/styles/tokens.css", "utf8").matchAll(
      /(--nb-[a-z0-9-]+)\s*:/g,
    ),
  ].map((m) => m[1]),
);
const registry = new Set(
  [
    ...readFileSync("lib/brain/status.ts", "utf8").matchAll(
      /"([a-z]+\.[a-z-]+)":/g,
    ),
  ].map((m) => m[1]),
);
const problems = [];
let count = 0;
function walk(path) {
  for (const name of readdirSync(path)) {
    const file = join(path, name);
    if (statSync(file).isDirectory()) {
      walk(file);
      continue;
    }
    if (
      ![".ts", ".tsx", ".css"].includes(extname(file)) ||
      basename(file) === "tokens.css"
    )
      continue;
    count++;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/var\((--nb-[a-z0-9-]+)/g))
      if (!tokens.has(m[1])) problems.push(file + ": unknown token " + m[1]);
    if (
      /dangerouslySetInnerHTML|backdrop-filter\s*:|filter\s*:\s*blur/.test(text)
    )
      problems.push(file + ": unsafe rendering/style");
    if (/(^|[^&\w-])#[0-9a-fA-F]{3,8}\b/.test(text))
      problems.push(file + ": hardcoded color");
    // Check status string literals, not legitimate JavaScript properties such as session.state.
    for (const m of text.matchAll(
      /["'`]((?:sync|trust|pub|session|origin|flag)\.[a-z-]+)["'`]/g,
    ))
      if (!registry.has(m[1])) problems.push(file + ": unknown status " + m[1]);
    if (
      /from ['"](?:three|@react-three)/.test(text) &&
      !file.startsWith("components/brain/graph/webgl/")
    )
      problems.push(file + ": WebGL outside optional renderer");
  }
}
for (const root of ["app", "components", "lib/brain"]) walk(root);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `PASS ${count} files, ${tokens.size} tokens, ${registry.size} status keys`,
  );
