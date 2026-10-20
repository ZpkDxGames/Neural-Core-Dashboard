"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CircleCheck,
  Clock,
  House,
  KeyRound,
  Server,
  Unplug,
  Hourglass,
  CircleX,
  CircleDashed,
  CircleDot,
  CircleSlash,
  GitCompareArrows,
  UserRoundCheck,
  FlaskConical,
  Minus,
  X,
} from "lucide-react";
import { STATUS_REGISTRY, type StatusKey } from "@/lib/brain/status";
import { assertRenderable } from "@/lib/brain/envelope";
import type { DataEnvelope, DataOrigin, PageState } from "@/lib/brain/types";
export function announce(text: string) {
  const el = document.getElementById("nb-live-polite");
  if (el) el.textContent = text;
}
const icons: Record<string, typeof House> = {
  house: House,
  "key-off": KeyRound,
  "server-check": Server,
  clock: Clock,
  split: GitCompareArrows,
  "plug-off": Unplug,
  "hourglass-off": Hourglass,
  "x-circle": CircleX,
  "check-circle": CircleCheck,
  "dashed-circle": CircleDashed,
  "dotted-circle": CircleDot,
  "slash-circle": CircleSlash,
  "clock-arrow": Clock,
  check: CircleCheck,
  spinner: Clock,
  "user-check": UserRoundCheck,
  flask: FlaskConical,
};
export function StatusBadge({
  status,
  count,
}: {
  status: StatusKey;
  count?: number;
}) {
  const def = STATUS_REGISTRY[status],
    Icon = icons[def.icon] ?? Minus;
  return (
    <span
      className={`nb-badge tone-${def.tone}`}
      data-status={status}
      data-testid={`nb-status-${status}`}
    >
      <Icon size={13} aria-hidden="true" data-icon={def.icon} />
      {def.label}
      {count === undefined ? "" : ` · ${count}`}
    </span>
  );
}
export function OriginChip({
  origin,
  confirmedAt,
}: {
  origin: DataOrigin;
  confirmedAt?: string;
}) {
  return (
    <span className="nb-origin" data-origin={origin}>
      {origin === "local" ? (
        <House size={12} />
      ) : origin === "demo" ? (
        <FlaskConical size={12} />
      ) : (
        <Server size={12} />
      )}
      <span>
        {origin === "local"
          ? "This browser"
          : origin === "demo"
            ? "Demo · synthetic"
            : confirmedAt
              ? "Backend · confirmed"
              : "Backend unavailable"}
      </span>
    </span>
  );
}
export function KpiTile({
  id,
  label,
  value,
  help,
}: {
  id: string;
  label: string;
  value: DataEnvelope<number | string>;
  help: string;
}) {
  if (!value.origin) throw Error("KPI origin required");
  assertRenderable(value);
  return (
    <article
      className="nb-kpi"
      data-origin={value.origin}
      data-testid={`nb-kpi-${id}`}
      aria-label={label}
    >
      <div className="nb-kpi-label">
        {label}
        <span aria-hidden="true">↗</span>
      </div>
      <div className="nb-kpi-value nb-num">
        {value.state === "ready" || value.state === "partial" ? (
          typeof value.data === "number" ? (
            value.data.toLocaleString()
          ) : (
            value.data
          )
        ) : value.state === "empty" ? (
          "0"
        ) : value.state === "loading" ? (
          <span className="nb-skeleton" />
        ) : (
          "—"
        )}
      </div>
      <div className="nb-kpi-bottom">
        <OriginChip origin={value.origin} confirmedAt={value.confirmedAt} />
        {value.state === "partial" ? (
          <span className="nb-text-warn">Incomplete</span>
        ) : null}
      </div>
      <p>{help}</p>
    </article>
  );
}
export function StateSurface({
  state = "empty",
  title,
  description,
  children,
  route = "",
}: {
  state?: PageState | "unavailable";
  title: string;
  description?: string;
  children?: ReactNode;
  route?: string;
}) {
  return (
    <section
      className={`nb-state nb-state-${state}`}
      data-state={state}
      data-route={route}
      data-testid={`nb-state-${state}`}
    >
      <div className="nb-state-mark">
        <Minus size={22} aria-hidden="true" />
      </div>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {children}
    </section>
  );
}
export function TruthfulButton({
  id,
  children,
  reason,
}: {
  id: string;
  children: ReactNode;
  reason: string;
}) {
  return (
    <div className="nb-truthful">
      <button
        type="button"
        className="nb-button"
        aria-disabled="true"
        aria-describedby={id + "-reason"}
        data-testid={"nb-switch-" + id}
        data-unavailable="true"
        onClick={() => announce(reason)}
      >
        {children}
      </button>
      <p id={id + "-reason"}>{reason}</p>
    </div>
  );
}
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    invoker = useRef<HTMLElement | null>(null);
  const titleId = "dialog-" + title.toLowerCase().replace(/[^a-z]+/g, "-");
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    invoker.current = document.activeElement as HTMLElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (invoker.current?.isConnected) invoker.current.focus();
    };
  }, [open]);
  return open ? (
    <dialog
      ref={ref}
      className="nb-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="nb-dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="nb-icon-button"
          aria-label="Close dialog"
          onClick={onClose}
          data-testid="nb-dialog-close"
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  ) : null;
}
export function ConfirmDelete({
  open,
  onClose,
  onConfirm,
  count,
  all = true,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<unknown>;
  count: number;
  all?: boolean;
}) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) {
      setText("");
      setFailed(false);
      setTimeout(() => cancel.current?.focus(), 0);
    }
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Delete browser conversations"
    >
      <p>
        Delete {count.toLocaleString()} conversations from this browser. This
        can’t be undone. Files you exported earlier are not affected.
      </p>
      {all ? (
        <label className="nb-field">
          Type DELETE to confirm
          <input
            data-testid="nb-delete-confirm-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
          />
        </label>
      ) : null}
      {failed ? (
        <p role="alert">
          Deletion could not be confirmed. Check browser storage and retry.
        </p>
      ) : null}
      <div className="nb-dialog-actions">
        <button
          className="nb-button"
          ref={cancel}
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          className="nb-button danger"
          data-testid="nb-delete-confirm"
          disabled={busy || (all && text !== "DELETE")}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch {
              setFailed(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Working…" : "Delete conversations"}
        </button>
      </div>
    </Modal>
  );
}
export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="nb-page-heading">
      <div>
        {eyebrow ? <div className="nb-eyebrow">{eyebrow}</div> : null}
        <h1 tabIndex={-1}>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
