"use client";
import Link from "next/link";
import { useMemo } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  FileUp,
  Database,
  FolderOpen,
  Network,
  Shield,
  MessageSquare,
} from "lucide-react";
import { useBrain } from "./BrainProvider";
import {
  KpiTile,
  OriginChip,
  SectionHeading,
  StateSurface,
  StatusBadge,
} from "./Primitives";
import { unavailable } from "@/lib/brain/envelope";
import type { DataEnvelope } from "@/lib/brain/types";
export function Overview({ moved = false }: { moved?: boolean }) {
  const b = useBrain();
  const recent = useMemo(
    () =>
      [...b.stored]
        .sort(
          (a, c) =>
            (Date.parse(c.updatedAt ?? c.createdAt ?? "") || 0) -
            (Date.parse(a.updatedAt ?? a.createdAt ?? "") || 0),
        )
        .slice(0, 5),
    [b.stored],
  );
  const local = (value: number, analysis = false): DataEnvelope<number> =>
    b.errors.some(
      (e) =>
        e.code === "STORAGE_UNAVAILABLE" ||
        (analysis && e.code === "ANALYSIS_FAILED"),
    )
      ? {
          origin: "local",
          state: "error",
          error: {
            ...b.errors.find(
              (e) =>
                e.code === "STORAGE_UNAVAILABLE" ||
                (analysis && e.code === "ANALYSIS_FAILED"),
            )!,
            retryable: true,
          },
        }
      : b.loading || (analysis && !b.analysis)
        ? { origin: "local", state: "loading" }
        : analysis && b.total > b.stored.length
          ? {
              origin: "local",
              state: "partial",
              readAt: b.readAt,
              data: value,
              missing: ["50,000-record / 32 MiB browser preview window"],
            }
          : { origin: "local", state: "ready", readAt: b.readAt, data: value };
  return (
    <>
      <SectionHeading
        eyebrow="Personal knowledge workspace"
        title="Overview"
        description="A clear view of your conversations, their evidence, and the knowledge you choose to keep."
        action={
          <Link
            className="nb-button primary"
            href="/sources?tab=imports"
            prefetch={false}
          >
            <FileUp size={16} />
            Import an archive
          </Link>
        }
      />
      {moved ? (
        <p className="nb-helper" role="status">
          That view moved. Use the workspace navigation to continue.
        </p>
      ) : null}
      <section className="nb-section" aria-labelledby="local-heading">
        <div className="nb-section-heading">
          <h2 id="local-heading">This browser</h2>
          <OriginChip origin="local" />
        </div>
        <div className="nb-kpis">
          <KpiTile
            id="K1"
            label="Conversations"
            value={local(b.total)}
            help="Archives saved in this browser profile."
          />
          <KpiTile
            id="K2"
            label="Messages"
            value={local(b.analysis?.messages ?? 0, true)}
            help="Messages in the loaded browser archive."
          />
          <KpiTile
            id="K3"
            label="Providers"
            value={local(Object.keys(b.analysis?.providers ?? {}).length, true)}
            help="Providers represented by imported records."
          />
          <KpiTile
            id="K5"
            label="Linked concepts"
            value={local(b.analysis?.concepts ?? 0, true)}
            help="Literal topic mentions with source citations."
          />
        </div>
      </section>
      {b.total > b.stored.length ? (
        <div className="nb-banner" data-state="partial">
          Showing {b.stored.length.toLocaleString()} of{" "}
          {b.total.toLocaleString()} conversations. Message and concept
          summaries cover the loaded window.
        </div>
      ) : null}
      {!b.loading && b.total === 0 ? (
        <section className="nb-overview-hero" data-testid="nb-overview-empty">
          <div>
            <span className="nb-eyebrow">Start with what matters</span>
            <h2>Your knowledge deserves more than another chat history.</h2>
            <p>
              Bring your conversations into a private, searchable archive.
              Explore literal connections, inspect the source, and keep control
              of your data.
            </p>
            <div className="nb-actions">
              <Link className="nb-button primary" href="/sources?tab=imports">
                Import an archive
                <ArrowRight size={15} />
              </Link>
              <Link className="nb-button" href="/graph?demo=1">
                Explore the demo
                <ArrowUpRight size={15} />
              </Link>
            </div>
          </div>
          <div
            className="nb-architecture"
            aria-label="Available storage layers"
          >
            <div className="nb-layer">
              <Database size={20} />
              <strong>Browser archive</strong>
              <span>Ready for local import</span>
            </div>
            <div className="nb-layer">
              <FolderOpen size={20} />
              <strong>Markdown vault</strong>
              <span>Not connected</span>
            </div>
            <div className="nb-layer">
              <Network size={20} />
              <strong>Agent proposals</strong>
              <span>Unavailable</span>
            </div>
            <p className="nb-helper">
              Owner sign-in and synchronization are separate permissions.
            </p>
          </div>
        </section>
      ) : null}
      <div className="nb-grid-two nb-section">
        <section className="nb-panel">
          <div className="nb-panel-head">
            <div>
              <h2>Conversation archive</h2>
              <p>Private to this browser. Search without uploading.</p>
            </div>
            <Link
              href="/library"
              aria-label="Open conversation library"
              className="nb-icon-button"
            >
              <ArrowUpRight size={17} />
            </Link>
          </div>
          {recent.length ? (
            recent.map((c) => (
              <Link
                className="nb-row"
                href={"/library/local/" + encodeURIComponent(c.id)}
                key={c.id}
                prefetch={false}
              >
                <MessageSquare size={17} />
                <div>
                  <strong>{c.title}</strong>
                  <small>
                    {c.provider} · {c.messages.length} messages
                  </small>
                </div>
                <ArrowUpRight size={14} />
              </Link>
            ))
          ) : (
            <StateSurface
              title="No memories imported yet."
              description="Import a supported JSON archive to build your local library."
            />
          )}
        </section>
        <section className="nb-panel" id="topics">
          <div className="nb-panel-head">
            <div>
              <h2>Topic distribution</h2>
              <p>
                {Object.keys(b.analysis?.categories ?? {}).length} observed
                categories · rule-based
              </p>
            </div>
            <StatusBadge status="trust.heuristic" />
          </div>
          <div className="nb-panel-body">
            {b.analysis && Object.entries(b.analysis.categories).length ? (
              Object.entries(b.analysis.categories)
                .sort((a, c) => c[1] - a[1])
                .map(([name, count]) => (
                  <div className="nb-topic-row" key={name}>
                    <span>{name}</span>
                    <div className="nb-topic-track">
                      <span
                        style={{
                          width:
                            (100 * count) / Math.max(1, b.stored.length) + "%",
                        }}
                      />
                    </div>
                    <span className="nb-num">{count}</span>
                  </div>
                ))
            ) : (
              <p className="nb-helper">
                Topic frequencies appear after an archive is imported. They are
                matching rules, not verified facts.
              </p>
            )}
          </div>
        </section>
      </div>
      <section className="nb-section">
        <div className="nb-section-heading">
          <div>
            <h2>Private memory system</h2>
            <p className="nb-helper">
              Remote data requires a separately authorized connection.
            </p>
          </div>
          <StatusBadge status="sync.local-only" />
        </div>
        <div className="nb-kpis">
          {(
            [
              ["K6", "Published notes"],
              ["K7", "Awaiting review"],
              ["K8", "Publish queue"],
              ["K9", "Last publication"],
            ] as const
          ).map(([id, label]) => (
            <KpiTile
              key={id}
              id={id}
              label={label}
              value={unavailable("REMOTE_NOT_CONFIGURED")}
              help="Not available to this browser."
            />
          ))}
        </div>
      </section>
      <div className="nb-helper">
        <Shield size={13} /> Local archive ownership stays with you. No agents
        or remote vault are connected.
      </div>
    </>
  );
}
