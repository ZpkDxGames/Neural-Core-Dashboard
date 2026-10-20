"use client";
import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import {
  readConversationWindow,
  saveConversations,
  deleteLocalConversations,
} from "@/lib/store";
import type { Conversation } from "@/lib/types";
import type { ImportResult } from "@/lib/archive";
import { messages } from "@/lib/brain/messages";
export type Preview = ImportResult & { duplicatesWithinFile: number };
type Analysis = {
  categories: Record<string, number>;
  providers: Record<string, number>;
  byId: Record<string, string>;
  messages: number;
  concepts: number;
};
type UiError = { code: string; message: string; ref: string; at: string };
type Prefs = {
  theme: "system" | "light" | "dark";
  density: "comfortable" | "compact";
  motion: "system" | "reduce" | "full";
  renderer: "2d" | "3d";
  singleKey: boolean;
};
type Brain = {
  items: Conversation[];
  stored: Conversation[];
  sessionIds: Set<string>;
  total: number;
  loading: boolean;
  readAt: string;
  analysis: Analysis | null;
  online: boolean;
  notice: string;
  setNotice: (s: string) => void;
  errors: UiError[];
  report: (code: string) => void;
  dismissError: (ref: string) => void;
  reload: () => Promise<void>;
  save: (p: Preview) => Promise<void>;
  keepInTab: (p: Preview) => void;
  remove: (ids: string[] | null) => Promise<number>;
  exportLocal: () => Promise<void>;
  drafts: Record<string, string>;
  setDraft: (id: string, body: string) => void;
  prefs: Prefs;
  preference: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  libraryQuery: string;
  setLibraryQuery: (q: string) => void;
};
const Context = createContext<Brain | null>(null);
const defaultPrefs: Prefs = {
  theme: "system",
  density: "comfortable",
  motion: "system",
  renderer: "2d",
  singleKey: false,
};
const errorCopy: Record<string, string> = {
  STORAGE_UNAVAILABLE:
    "Browser storage is unavailable. Local data could not be read.",
  IMPORT_FAILED:
    "Saving to browser storage failed. Check available storage and retry.",
  DELETE_FAILED:
    "Deletion could not be confirmed. Reload the library to check its state.",
  CLIPBOARD: "Clipboard access was denied.",
  EXPORT_LIMIT:
    "The archive exceeds the supported export window. Export is unavailable for this collection.",
  ANALYSIS_FAILED: "Local topic analysis could not complete. Reload to retry.",
  UNKNOWN_ERROR: "Something went wrong. Retry the operation.",
};
export function BrainProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Conversation[]>([]),
    [temporary, setTemporary] = useState<Conversation[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true),
    [readAt, setReadAt] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null),
    [online, setOnline] = useState(true),
    [notice, setNotice] = useState(""),
    [errors, setErrors] = useState<UiError[]>([]),
    [prefs, setPrefs] = useState<Prefs>(defaultPrefs),
    [libraryQuery, setLibraryQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const sequence = useRef(0);
  const report = useCallback((code: string) => {
    const value = {
      code: errorCopy[code]! ? code : "UNKNOWN_ERROR",
      message: errorCopy[code]! ?? errorCopy.UNKNOWN_ERROR,
      ref: crypto.randomUUID(),
      at: new Date().toISOString(),
    };
    setErrors((previous) => [...previous.slice(-49), value]);
    setNotice(value.message);
  }, []);
  const reload = useCallback(async () => {
    const n = ++sequence.current;
    try {
      const r = await readConversationWindow();
      if (n !== sequence.current) return;
      setStored(r.items);
      setTotal(r.total);
      setReadAt(new Date().toISOString());
    } catch {
      report("STORAGE_UNAVAILABLE");
    } finally {
      if (n === sequence.current) setLoading(false);
    }
  }, [report]);
  useEffect(() => {
    void reload();
    return () => {
      sequence.current++;
    };
  }, [reload]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    addEventListener("online", update);
    addEventListener("offline", update);
    return () => {
      removeEventListener("online", update);
      removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("nb.preferences") ?? "{}",
      ) as Record<string, unknown>;
      const next = { ...defaultPrefs };
      if (["system", "light", "dark"].includes(String(saved.theme)))
        next.theme = saved.theme as Prefs["theme"];
      if (["comfortable", "compact"].includes(String(saved.density)))
        next.density = saved.density as Prefs["density"];
      if (["system", "reduce", "full"].includes(String(saved.motion)))
        next.motion = saved.motion as Prefs["motion"];
      if (saved.renderer === "2d" || saved.renderer === "3d")
        next.renderer = saved.renderer;
      if (typeof saved.singleKey === "boolean")
        next.singleKey = saved.singleKey;
      setPrefs(next);
    } catch {
      /* Preferences are optional; blocked storage leaves session defaults. */
    }
  }, []);
  useEffect(() => {
    for (const [key, value] of [
      ["theme", prefs.theme],
      ["density", prefs.density],
      ["motion", prefs.motion],
    ] as const) {
      if (value === "system") delete document.documentElement.dataset[key];
      else document.documentElement.dataset[key] = value;
    }
  }, [prefs]);
  useEffect(() => {
    if (!stored.length) {
      setAnalysis({
        categories: {},
        providers: {},
        byId: {},
        messages: 0,
        concepts: 0,
      });
      return;
    }
    setAnalysis(null);
    const worker = new Worker(
      new URL("../../lib/brain/analysis.worker.ts", import.meta.url),
      { type: "module" },
    );
    const fail = () => {
      worker.terminate();
      setAnalysis(null);
      report("ANALYSIS_FAILED");
    };
    const deadline = setTimeout(fail, 15000);
    worker.onmessage = (e) => {
      clearTimeout(deadline);
      setAnalysis(e.data as Analysis);
      worker.terminate();
    };
    worker.onerror = () => {
      clearTimeout(deadline);
      fail();
    };
    worker.postMessage({ items: stored });
    return () => {
      clearTimeout(deadline);
      worker.terminate();
    };
  }, [stored, report]);
  const preference: Brain["preference"] = (key, value) =>
    setPrefs((p) => {
      const next = { ...p, [key]: value };
      try {
        localStorage.setItem("nb.preferences", JSON.stringify(next));
      } catch {}
      return next;
    });
  const items = useMemo(
    () => [
      ...new Map([...stored, ...temporary].map((c) => [c.id, c])).values(),
    ],
    [stored, temporary],
  );
  const sessionIds = useMemo(
    () => new Set(temporary.map((c) => c.id)),
    [temporary],
  );
  async function save(p: Preview) {
    try {
      await saveConversations(p.conversations);
      setTemporary([]);
      await reload();
      setNotice(
        `Saved ${p.conversations.length} conversations to this browser. Nothing was uploaded.`,
      );
    } catch {
      report("IMPORT_FAILED");
      throw Error("IMPORT_FAILED");
    }
  }
  function keepInTab(p: Preview) {
    setTemporary(p.conversations);
    setNotice(
      "These conversations will disappear when you close this tab. Nothing has been stored or uploaded.",
    );
  }
  async function remove(ids: string[] | null) {
    try {
      const count = await deleteLocalConversations(ids);
      if (ids === null) setTemporary([]);
      else setTemporary((p) => p.filter((c) => !ids.includes(c.id)));
      await reload();
      setNotice(`Deleted ${count} conversations from this browser.`);
      return count;
    } catch {
      report("DELETE_FAILED");
      throw Error("DELETE_FAILED");
    }
  }
  async function exportLocal() {
    let data;
    try {
      data = await readConversationWindow();
    } catch {
      report("STORAGE_UNAVAILABLE");
      return;
    }
    if (data.items.length < data.total) {
      report("EXPORT_LIMIT");
      return;
    }
    const blob = new Blob(
        [
          JSON.stringify(
            {
              format: "neural-core-v1",
              exportedAt: new Date().toISOString(),
              conversations: data.items,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "neural-core-local-export.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(
      `Export created for ${data.items.length} conversations. Keep this file private.`,
    );
  }
  return (
    <Context.Provider
      value={{
        items,
        stored,
        sessionIds,
        total,
        loading,
        readAt,
        analysis,
        online,
        notice,
        setNotice,
        errors,
        report,
        dismissError: (ref) => setErrors((p) => p.filter((e) => e.ref !== ref)),
        reload,
        save,
        keepInTab,
        remove,
        exportLocal,
        drafts,
        setDraft: (id, body) =>
          setDrafts((previous) => {
            const next = { ...previous, [id]: body.slice(0, 200000) };
            for (const key of Object.keys(next).slice(
              0,
              Math.max(0, Object.keys(next).length - 20),
            ))
              delete next[key];
            return next;
          }),
        prefs,
        preference,
        libraryQuery,
        setLibraryQuery,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useBrain() {
  const value = useContext(Context);
  if (!value) throw Error("BrainProvider required");
  return value;
}
