"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  BrainCircuit,
  LayoutDashboard,
  Network,
  Library,
  UsersRound,
  FolderInput,
  Activity,
  Settings2,
  Search,
  Sun,
  Moon,
  ArrowUpRight,
  Shield,
  ChevronRight,
  MoreHorizontal,
  X,
  Command,
  House,
  Database,
  HardDrive,
} from "lucide-react";
import { useBrain } from "./BrainProvider";
import { Modal, StatusBadge, announce } from "./Primitives";
import { messages } from "@/lib/brain/messages";
const nav = [
  {
    id: "overview",
    label: "Overview",
    href: "/",
    icon: LayoutDashboard,
    group: "Workspace",
  },
  {
    id: "graph",
    label: "Neural Graph",
    href: "/graph",
    icon: Network,
    group: "Workspace",
  },
  {
    id: "library",
    label: "Knowledge Library",
    href: "/library",
    icon: Library,
    group: "Workspace",
  },
  {
    id: "agents",
    label: "Agent Workspace",
    href: "/agents",
    icon: UsersRound,
    group: "Workspace",
  },
  {
    id: "sources",
    label: "Sources & Imports",
    href: "/sources",
    icon: FolderInput,
    group: "Data",
  },
  {
    id: "activity",
    label: "Activity & Audit",
    href: "/activity",
    icon: Activity,
    group: "Data",
  },
  {
    id: "settings",
    label: "Settings & Privacy",
    href: "/settings",
    icon: Settings2,
    group: "System",
  },
] as const;
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    router = useRouter(),
    brain = useBrain(),
    [palette, setPalette] = useState(false),
    [interactive, setInteractive] = useState(false),
    [query, setQuery] = useState(""),
    [more, setMore] = useState(false),
    [connection, setConnection] = useState(false),
    [active, setActive] = useState(0);
  const current =
    nav.find((n) =>
      n.href === "/" ? pathname === "/" : pathname.startsWith(n.href),
    ) ?? nav[0];
  const paletteRef = useRef<HTMLInputElement>(null);
  const destinations = nav
    .filter((n) => n.label.toLowerCase().includes(query.toLowerCase()))
    .map((n) => ({ label: n.label, href: n.href, kind: "Navigate" }));
  const local = query
    ? brain.items
        .filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 8)
        .map((c) => ({
          label: c.title,
          href: "/library/local/" + encodeURIComponent(c.id),
          kind: c.provider + " · this browser",
        }))
    : [];
  const results = [...destinations, ...local].slice(0, 50);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    addEventListener("keydown", onKey);
    setInteractive(true);
    return () => removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const keyboard = () => {
        document.documentElement.dataset.inputModality = "keyboard";
      },
      pointer = () => {
        document.documentElement.dataset.inputModality = "pointer";
      };
    addEventListener("keydown", keyboard);
    addEventListener("pointerdown", pointer);
    return () => {
      removeEventListener("keydown", keyboard);
      removeEventListener("pointerdown", pointer);
    };
  }, []);
  useEffect(() => {
    if (palette) {
      setActive(0);
      setTimeout(() => paletteRef.current?.focus(), 0);
    }
  }, [palette]);
  useEffect(() => {
    if (!brain.prefs.singleKey) return;
    let prefix = 0;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest("input,textarea,select,[contenteditable=true]") ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if (e.key === "g" && (!prefix || performance.now() - prefix >= 1200)) {
        prefix = performance.now();
        return;
      }
      const destinations: Record<string, string> = {
        o: "/",
        g: "/graph",
        l: "/library",
        a: "/agents",
        s: "/sources",
        y: "/activity",
        ",": "/settings",
      };
      if (prefix && performance.now() - prefix < 1200 && destinations[e.key]!) {
        e.preventDefault();
        prefix = 0;
        router.push(destinations[e.key]!);
      } else if (e.key === "/") {
        e.preventDefault();
        setPalette(true);
      }
    };
    addEventListener("keydown", handler);
    return () => removeEventListener("keydown", handler);
  }, [brain.prefs.singleKey, router]);
  useEffect(() => {
    document.title = current.label + " · Neural Brain";
    setMore(false);
    const frame = requestAnimationFrame(() => {
      if (!document.querySelector("dialog[open]"))
        document.querySelector<HTMLElement>("main h1")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, current.label]);
  function go(href: string) {
    setPalette(false);
    setMore(false);
    router.push(href);
  }
  const navLink = (n: (typeof nav)[number], mobile = false) => (
    <Link
      key={n.id}
      href={n.href}
      prefetch={false}
      className={`nb-nav-link ${current.id === n.id ? "active" : ""}`}
      aria-label={mobile && n.id === "agents" ? "Agents" : n.label}
      title={n.label}
      aria-current={current.id === n.id ? "page" : undefined}
      data-testid={mobile ? "nb-mobile-" + n.id : "nb-nav-" + n.id}
    >
      <n.icon size={19} strokeWidth={1.65} aria-hidden="true" />
      <span>
        {mobile
          ? n.id === "overview"
            ? "Overview"
            : n.id === "graph"
              ? "Graph"
              : n.id === "library"
                ? "Library"
                : "Agents"
          : n.label}
      </span>
    </Link>
  );
  return (
    <div
      className="nb-shell"
      data-testid="nb-shell"
      data-interactive={interactive}
      data-conn="sync.local-only"
    >
      <a href="#main" className="nb-skip">
        Skip to main content
      </a>
      <a href="#nb-inspector-root" className="nb-skip">
        Skip to inspector
      </a>
      <aside className="nb-sidebar">
        <Link
          href="/"
          className="nb-brand"
          aria-label="neuralbrain Knowledge Workspace home"
        >
          <span className="nb-brand-symbol">
            <BrainCircuit size={22} />
          </span>
          <span className="nb-brand-name">
            neural<span>brain</span> <small>KNOWLEDGE WORKSPACE</small>
          </span>
        </Link>
        <div className="nb-workspace-label">
          <span className="nb-workspace-icon">
            <House size={16} />
          </span>
          <span>
            Personal workspace<small>Browser-local mode</small>
          </span>
        </div>
        <nav aria-label="Primary">
          {["Workspace", "Data", "System"].map((group) => (
            <div className="nb-nav-group" key={group}>
              <div className="nb-eyebrow">{group}</div>
              {nav.filter((n) => n.group === group).map((n) => navLink(n))}
            </div>
          ))}
        </nav>
        <div className="nb-sidebar-bottom">
          <div className="nb-privacy-card">
            <Shield size={18} />
            <div>
              <strong>Your data stays here</strong>
              <p>Local archive. No remote sync.</p>
            </div>
          </div>
          <div className="nb-version">
            <span>Neural Brain V2</span>
            <span>Development</span>
          </div>
        </div>
      </aside>
      <header className="nb-topbar">
        <div className="nb-breadcrumb">
          <span>Workspace</span>
          <ChevronRight size={14} />
          <strong>{current.label}</strong>
        </div>
        <div className="nb-top-actions">
          <button
            className="nb-search-trigger"
            data-testid="nb-search-open"
            aria-label="Search workspace ⌘ K"
            onClick={() => {
              setQuery("");
              setPalette(true);
            }}
          >
            <Search size={16} />
            <span>Search workspace</span> <kbd>⌘ K</kbd>
          </button>
          <button
            className="nb-connection-button"
            data-testid="nb-conn-badge"
            aria-label="Connection: Local only. Remote synchronization is not enabled in this build."
            onClick={() => setConnection(true)}
          >
            <StatusBadge status="sync.local-only" />
          </button>
          <button
            className="nb-icon-button nb-theme"
            data-testid="nb-theme-toggle"
            aria-label="Toggle light and dark theme"
            onClick={() =>
              brain.preference(
                "theme",
                brain.prefs.theme === "dark" ? "light" : "dark",
              )
            }
          >
            {brain.prefs.theme === "dark" ? (
              <Sun size={17} />
            ) : (
              <Moon size={17} />
            )}
          </button>
          <Link
            className="nb-owner-chip"
            href="/settings?tab=owner"
            prefetch={false}
            aria-label="Owner identity settings"
          >
            Owner
            <ArrowUpRight size={12} />
          </Link>
        </div>
      </header>
      <div className="nb-banners">
        {!brain.online ? (
          <div
            className="nb-banner"
            data-testid="nb-offline-banner"
            role="status"
          >
            Offline. Local features still work. Remote synchronization is not
            enabled.
          </div>
        ) : null}
        {brain.notice ? (
          <div
            className="nb-banner nb-notice"
            role="status"
            data-testid="nb-notice"
          >
            <span>{brain.notice}</span>
            <button
              className="nb-icon-button"
              aria-label="Dismiss notice"
              onClick={() => brain.setNotice("")}
            >
              <X size={15} />
            </button>
          </div>
        ) : null}
      </div>
      <main
        id="main"
        className={"nb-main " + (current.id === "graph" ? "nb-main-graph" : "")}
        tabIndex={-1}
      >
        {children}
        <div id="nb-inspector-root" tabIndex={-1} />
      </main>
      <nav className="nb-tabbar" aria-label="Mobile navigation">
        {nav.slice(0, 4).map((n) => navLink(n, true))}
        <button
          aria-label="More navigation"
          className="nb-nav-link"
          data-testid="nb-mobile-more"
          onClick={() => setMore(true)}
        >
          <MoreHorizontal size={20} />
          <span>More</span>
        </button>
      </nav>
      <div id="nb-live-polite" className="nb-sr-only" role="status" />
      <div id="nb-live-assertive" className="nb-sr-only" role="alert" />
      <Modal open={more} onClose={() => setMore(false)} title="More navigation">
        <div className="nb-dialog-links">
          {nav.slice(4).map((n) => (
            <button key={n.id} className="nb-button" onClick={() => go(n.href)}>
              <n.icon size={18} />
              {n.label}
              <ArrowUpRight size={14} />
            </button>
          ))}
          <StatusBadge status="sync.local-only" />
        </div>
      </Modal>
      <Modal
        open={connection}
        onClose={() => setConnection(false)}
        title="Connection layers"
      >
        <p>{messages.remote}</p>
        <div className="nb-layer-list">
          {[
            {
              name: "Browser storage",
              icon: Database,
              detail: brain.loading
                ? "Checking…"
                : brain.errors.some((e) => e.code === "STORAGE_UNAVAILABLE")
                  ? "Unavailable"
                  : "Read in this browser",
            },
            {
              name: "Private gateway",
              icon: Network,
              detail: "Not configured",
            },
            {
              name: "Markdown vault",
              icon: FolderInput,
              detail: "Not connected",
            },
            {
              name: "PostgreSQL projection",
              icon: HardDrive,
              detail: "Unavailable to this browser",
            },
          ].map((layer) => (
            <div className="nb-layer" key={layer.name}>
              <layer.icon size={19} />
              <strong>{layer.name}</strong>
              <span>{layer.detail}</span>
            </div>
          ))}
        </div>
        <Link
          href="/settings?tab=sync"
          onClick={() => setConnection(false)}
          className="nb-button"
        >
          Sync settings
          <ArrowUpRight size={15} />
        </Link>
      </Modal>
      <Modal
        open={palette}
        onClose={() => setPalette(false)}
        title="Search workspace"
      >
        <div className="nb-palette-search">
          <Search size={20} />
          <input
            ref={paletteRef}
            role="combobox"
            aria-label="Search workspace"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="nb-palette-results"
            aria-activedescendant={
              results[active] ? "nb-palette-option-" + active : undefined
            }
            data-testid="nb-palette-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((v) => Math.min(v + 1, results.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((v) => Math.max(0, v - 1));
              }
              if (e.key === "Enter" && results[active])
                go(results[active].href);
            }}
          />
        </div>
        <ul
          id="nb-palette-results"
          role="listbox"
          aria-label="Workspace results"
          className="nb-palette-results"
        >
          {results.map((r, i) => (
            <li
              id={"nb-palette-option-" + i}
              key={r.href}
              role="option"
              aria-selected={i === active}
              onClick={() => go(r.href)}
            >
              <span>{r.label}</span>
              <small>{r.kind}</small>
              <ChevronRight size={14} />
            </li>
          ))}
        </ul>
        <p className="nb-helper">
          Vault notes unavailable. Search stays in this browser.
        </p>
        <div className="nb-palette-hint">
          <Command size={13} />
          Navigate with ↑ ↓ · Enter to open · Esc to close
        </div>
      </Modal>
    </div>
  );
}
