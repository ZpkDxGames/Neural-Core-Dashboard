"use client";
import Link from "next/link";
import { PrivateConnectionSettings } from "./PrivateWorkspace";
import { useBrain } from "./BrainProvider";
import { OwnerIdentitySettings } from "@/components/OwnerIdentitySettings";
import { SectionHeading, StatusBadge, TruthfulButton } from "./Primitives";
import { DataActions } from "./Sources";
import { messages } from "@/lib/brain/messages";
export function Settings({ tab = "owner" }: { tab?: string }) {
  const b = useBrain();
  const active = ["owner", "sync", "data", "appearance"].includes(tab)
    ? tab
    : "owner";
  return (
    <>
      <SectionHeading
        eyebrow="System / Your boundaries"
        title="Settings & Privacy"
        description="Your identity, storage, and synchronization permissions stay separate."
      />
      <nav className="nb-tabs" aria-label="Settings sections">
        {["owner", "sync", "data", "appearance"].map((t) => (
          <Link
            className="nb-tab"
            key={t}
            href={"/settings?tab=" + t}
            aria-current={active === t ? "page" : undefined}
          >
            {t === "owner"
              ? "Owner"
              : t === "sync"
                ? "Sync"
                : t === "data"
                  ? "Data"
                  : "Appearance"}
          </Link>
        ))}
      </nav>
      <section className="nb-panel nb-settings-panel">
        {active === "owner" ? (
          <>
            <h2>Owner identity</h2>
            <p className="nb-helper">
              Signing in identifies the owner. It does not enable archive
              uploads, vault access, or agent synchronization.
            </p>
            <OwnerIdentitySettings />
            <div className="nb-section" style={{ marginTop: "var(--nb-sp-6)" }}>
              <h3>Server synchronization</h3>
              <span role="status" aria-label="Sync state: Local only">
                <StatusBadge status="sync.local-only" />
              </span>
              <p className="nb-helper">
                Local only. Remote identity, approved HTTPS ingress and explicit
                upload consent are required. This build does not send data to
                Oracle or Vercel.
              </p>
            </div>
          </>
        ) : null}
        {active === "sync" ? (
          <>
            <div className="nb-section-heading">
              <h2>Synchronization</h2>
              <StatusBadge status="sync.local-only" />
            </div>
            <PrivateConnectionSettings />
            <p>{messages.remote}</p>
            {(
              [
                ["remote-sync", "Remote synchronization"],
                ["sync-scopes", "Source scopes"],
                ["sync-agents", "Agent synchronization"],
              ] as const
            ).map(([id, label]) => (
              <div className="nb-preference-row" key={id}>
                <div>
                  <strong>{label}</strong>
                  <p>{messages.remote}</p>
                </div>
                <TruthfulButton id={id} reason={messages.remote}>
                  <span aria-hidden="true" className="nb-switch-track" />
                  {label} off
                </TruthfulButton>
              </div>
            ))}
            <h3 style={{ marginTop: "var(--nb-sp-6)" }}>What would be sent</h3>
            <p>
              Nothing in this build. Remote synchronization requires a
              separately approved private gateway and your explicit consent.
            </p>
          </>
        ) : null}
        {active === "data" ? (
          <>
            <h2>Browser archive</h2>
            <p>
              {b.total.toLocaleString()} conversations stored in this browser
              profile.
            </p>
            <DataActions />
            <h3 style={{ marginTop: "var(--nb-sp-8)" }}>
              Retention and backups
            </h3>
            <p>{messages.retention}</p>
            <p className="nb-helper">
              Retention period: not specified (owner decision). Browser exports
              and browser backups remain under your control.
            </p>
          </>
        ) : null}
        {active === "appearance" ? (
          <>
            <h2>Appearance</h2>
            <p className="nb-helper">
              Preferences stay in this browser. They contain no conversation
              content or identity credentials.
            </p>
            <label className="nb-preference-row">
              <div>
                <strong>Theme</strong>
                <p>System, light, or graphite dark.</p>
              </div>
              <select
                aria-label="Theme"
                data-testid="nb-pref-theme"
                value={b.prefs.theme}
                onChange={(e) =>
                  b.preference("theme", e.target.value as typeof b.prefs.theme)
                }
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="nb-preference-row">
              <div>
                <strong>Density</strong>
                <p>Touch targets remain accessible in both modes.</p>
              </div>
              <select
                aria-label="Density"
                value={b.prefs.density}
                onChange={(e) =>
                  b.preference(
                    "density",
                    e.target.value as typeof b.prefs.density,
                  )
                }
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
            <label className="nb-preference-row">
              <div>
                <strong>Motion</strong>
                <p>Reduced motion disables rotation and transitions.</p>
              </div>
              <select
                aria-label="Motion"
                value={b.prefs.motion}
                onChange={(e) =>
                  b.preference(
                    "motion",
                    e.target.value as typeof b.prefs.motion,
                  )
                }
              >
                <option value="system">System</option>
                <option value="reduce">Reduce</option>
                <option value="full">Full</option>
              </select>
            </label>
            <label className="nb-preference-row">
              <div>
                <strong>Graph renderer</strong>
                <p>3D loads only when selected and supported.</p>
              </div>
              <select
                aria-label="Graph renderer preference"
                value={b.prefs.renderer}
                onChange={(e) =>
                  b.preference("renderer", e.target.value as "2d" | "3d")
                }
              >
                <option value="2d">2D Canvas</option>
                <option value="3d">3D Sphere</option>
              </select>
            </label>
            <label className="nb-preference-row">
              <div>
                <strong>Single-key shortcuts</strong>
                <p>Optional workspace navigation shortcuts. Off by default.</p>
              </div>
              <input
                type="checkbox"
                aria-label="Single-key shortcuts"
                checked={b.prefs.singleKey}
                onChange={(e) => b.preference("singleKey", e.target.checked)}
              />
            </label>
          </>
        ) : null}
      </section>
    </>
  );
}
