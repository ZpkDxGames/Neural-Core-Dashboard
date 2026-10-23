"use client";
import Link from "next/link";
import {usePrivateMemory} from "./PrivateMemoryProvider";
import {RemoteReview,RemoteRegistry} from "./PrivateWorkspace";
import { useState, useMemo } from "react";
import { FlaskConical } from "lucide-react";
import {
  SectionHeading,
  StateSurface,
  TruthfulButton,
  StatusBadge,
} from "./Primitives";
import { messages } from "@/lib/brain/messages";
import { diffLines } from "@/lib/brain/diff";
export function ConflictDiff({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const line = (l: (typeof lines)[number], i: number) => (
    <span
      key={i}
      className={
        "nb-diff-line " +
        (l.kind === "added"
          ? "nb-diff-added"
          : l.kind === "removed"
            ? "nb-diff-removed"
            : "")
      }
    >
      <span aria-hidden="true">
        {l.kind === "added" ? "+ " : l.kind === "removed" ? "− " : "  "}
      </span>
      {l.kind !== "same" ? (
        <span className="nb-sr-only">
          {l.kind === "added" ? "Added: " : "Removed: "}
        </span>
      ) : null}
      {l.text}
      {"\n"}
    </span>
  );
  return (
    <div data-testid="nb-diff">
      <div className="nb-diff nb-diff-split">
        <section role="group" aria-label="Published revision">
          <h3>Published revision</h3>
          <pre>{lines.filter((l) => l.kind !== "added").map(line)}</pre>
        </section>
        <section role="group" aria-label="Proposed revision">
          <h3>Proposed revision</h3>
          <pre>{lines.filter((l) => l.kind !== "removed").map(line)}</pre>
        </section>
      </div>
      <section
        className="nb-diff-unified"
        role="group"
        aria-label="Unified comparison"
      >
        <h3>Unified comparison</h3>
        <pre>{lines.map(line)}</pre>
      </section>
    </div>
  );
}
export function Agents({ tab = "review" }: { tab?: string }) {
  const [demo, setDemo] = useState(false);
  const privateMemory=usePrivateMemory();
  if(privateMemory.configured&&tab==="review")return <RemoteReview/>;
  if(privateMemory.configured&&tab==="identities")return <RemoteRegistry/>;
  return (
    <>
      <SectionHeading
        eyebrow="Workspace / Controlled intelligence"
        title="Agent Workspace"
        description={messages.verify}
      />
      <nav className="nb-tabs" aria-label="Agent sections">
        {[
          ["review", "Review queue"],
          ["conflicts", "Conflicts"],
          ["identities", "Identities"],
        ].map(([id, label]) => (
          <Link
            className="nb-tab"
            href={"/agents?tab=" + id}
            aria-current={tab === id ? "page" : undefined}
            key={id}
          >
            {label}
          </Link>
        ))}
      </nav>
      <StateSurface
        state="unavailable"
        title={
          tab === "conflicts"
            ? "Conflict review unavailable"
            : tab === "identities"
              ? messages.agents
              : "Proposal queue unavailable"
        }
        description="The private agent registry and review endpoints have no approved browser connection. No live proposals or connected integrations are shown."
      />
      {tab === "conflicts" ? (
        <div className="nb-section" style={{ marginTop: "var(--nb-sp-6)" }}>
          <button
            className="nb-button"
            data-testid="nb-conflict-demo"
            onClick={() => setDemo((p) => !p)}
          >
            <FlaskConical size={15} />
            {demo
              ? "Close synthetic comparison"
              : "Preview a synthetic comparison"}
          </button>
          {demo ? (
            <section
              className="nb-panel nb-panel-body"
              style={{ marginTop: "var(--nb-sp-4)" }}
            >
              <div className="nb-demo-banner">
                <FlaskConical size={16} />
                {messages.demo}
              </div>
              <StatusBadge status="trust.proposed" />
              <h2 style={{ marginTop: "var(--nb-sp-5)" }}>
                SYNTH — Deployment procedure
              </h2>
              <ConflictDiff
                before={
                  "# Synthetic procedure\n\nRequire owner review.\nKeep backups private."
                }
                after={
                  "# Synthetic procedure\n\nRequire owner review and source evidence.\nKeep backups private.\nPublish only after the worker acknowledges."
                }
              />
              <TruthfulButton
                id="resolve-conflict"
                reason="This synthetic comparison cannot change a real note. An authorized owner review and backend acknowledgement are required."
              >
                Resolve conflict
              </TruthfulButton>
            </section>
          ) : null}
        </div>
      ) : null}
      <section className="nb-panel" style={{ marginTop: "var(--nb-sp-8)" }}>
        <div className="nb-panel-head">
          <div>
            <h2>Permission boundaries</h2>
            <p>{messages.verify}</p>
          </div>
        </div>
        <div
          className="nb-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Agent capability matrix"
        >
          <table data-testid="nb-capability-matrix">
            <caption className="nb-sr-only">
              Roles and permitted capabilities
            </caption>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                {["Viewer", "Contributor", "Maintainer", "Owner"].map((r) => (
                  <th scope="col" key={r}>
                    {r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["Read permitted notes", "Yes", "Yes", "Yes", "Yes"],
                ["Propose notes and relations", "No", "Yes", "Yes", "Yes"],
                [
                  "Consolidate duplicates",
                  "No",
                  "No",
                  "No",
                  "Yes",
                ],
                ["Mark a fact verified", "No", "No", "No", "Yes"],
                ["Grant permissions", "No", "No", "No", "Yes"],
                ["Delete, export, manage consent", "No", "No", "No", "Yes"],
              ].map((row) => (
                <tr key={row[0]}>
                  <th scope="row">{row[0]}</th>
                  {row.slice(1).map((v, i) => (
                    <td key={i}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="nb-helper">
        Text from agents and imported files is shown as content. It never grants
        permissions. ChatGPT, Claude, Gemini and future integrations require
        separately provisioned scoped identities.
      </p>
    </>
  );
}
