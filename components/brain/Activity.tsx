"use client";
import Link from "next/link";
import { useBrain } from "./BrainProvider";
import { SectionHeading, StateSurface } from "./Primitives";
export function Activity({ tab = "events" }: { tab?: string }) {
  const b = useBrain();
  return (
    <>
      <SectionHeading
        eyebrow="Data / Operational clarity"
        title="Activity & Audit"
        description="Confirmed events and errors, with clear boundaries between this browser and the private backend."
      />
      <nav className="nb-tabs" aria-label="Activity sections">
        {["events", "queue", "errors"].map((t) => (
          <Link
            className="nb-tab"
            href={"/activity?tab=" + t}
            key={t}
            aria-current={tab === t ? "page" : undefined}
          >
            {t === "events"
              ? "Events"
              : t === "queue"
                ? "Publish queue"
                : "Errors"}
          </Link>
        ))}
      </nav>
      {tab === "errors" ? (
        b.errors.length ? (
          <section className="nb-panel">
            <div className="nb-panel-head">
              <h2>Errors in this tab</h2>
              <p>
                Dismissal is local. This list is not persisted after reload.
              </p>
            </div>
            {b.errors.map((e) => (
              <article className="nb-panel-body" key={e.ref}>
                <h3>{e.message}</h3>
                <dl className="nb-metadata">
                  <dt>Code</dt>
                  <dd>
                    <code>{e.code}</code>
                  </dd>
                  <dt>Reference</dt>
                  <dd>
                    <code>{e.ref}</code>
                  </dd>
                  <dt>Time</dt>
                  <dd>
                    <time dateTime={e.at}>{e.at}</time>
                  </dd>
                </dl>
                <div className="nb-actions">
                  <button
                    className="nb-button"
                    onClick={() =>
                      void navigator.clipboard.writeText(
                        JSON.stringify({ code: e.code, ref: e.ref, at: e.at }),
                      )
                    }
                  >
                    Copy details
                  </button>
                  <button
                    className="nb-button"
                    onClick={() => b.dismissError(e.ref)}
                  >
                    Dismiss locally
                  </button>
                </div>
              </article>
            ))}
          </section>
        ) : (
          <StateSurface
            title="No errors recorded in this tab."
            description="Storage and operation failures stay here until dismissed or this tab is closed."
          />
        )
      ) : tab === "queue" ? (
        <StateSurface
          state="unavailable"
          title="Publish queue unavailable"
          description="This browser has no authorized connection to the vault worker. No queue depth or publication status is reported."
        />
      ) : (
        <StateSurface
          title="No events recorded in this browser yet."
          description="This build does not persist a browser activity log. The private backend audit feed is unavailable to this browser."
        />
      )}
    </>
  );
}
