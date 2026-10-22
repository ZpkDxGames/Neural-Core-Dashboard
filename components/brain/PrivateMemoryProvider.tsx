"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createSameOriginVault } from "@/lib/brain/private/adapter";
const Context = createContext<{
  configured: boolean;
  connected: boolean;
  version: number;
  adapter: ReturnType<typeof createSameOriginVault>;
  connect: () => Promise<boolean>;
  consent: (granted: boolean) => Promise<void>;
  disconnect: () => void;
  notice: string;
} | null>(null);
export function PrivateMemoryProvider({
  configured,
  children,
}: {
  configured: boolean;
  children: ReactNode;
}) {
  const [connected, setConnected] = useState(false),
    [version, setVersion] = useState(0),
    [notice, setNotice] = useState("");
  const adapter = useMemo(
    () =>
      createSameOriginVault({
        configured,
        onDisconnect: () => {
          setConnected(false);
          setVersion((n) => n + 1);
        },
        sessionCsrf: async () => {
          const r = await fetch("/api/auth/owner/session", {
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(10000),
          });
          if (!r.ok) return null;
          const value: unknown = await r.json();
          if (
            !value ||
            typeof value !== "object" ||
            !("csrf" in value) ||
            typeof value.csrf !== "string"
          )
            return null;
          return value.csrf;
        },
      }),
    [configured],
  );
  const disconnect = () => {
    adapter.disconnect();
    setConnected(false);
    setVersion((n) => n + 1);
  };
  useEffect(() => {
    const clear = () => {
      adapter.disconnect();
      setConnected(false);
      setVersion((n) => n + 1);
    };
    addEventListener("offline", clear);
    addEventListener("pagehide", clear);
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("neural-core-owner-session")
        : null;
    if (channel) channel.onmessage = clear;
    return () => {
      removeEventListener("offline", clear);
      removeEventListener("pagehide", clear);
      channel?.close();
      adapter.disconnect();
    };
  }, [adapter]);
  const connect = async () => {
    const ok = await adapter.connect();
    setConnected(ok);
    setVersion((n) => n + 1);
    setNotice(
      ok
        ? "Private gateway confirmed. Archive synchronization remains off."
        : "Owner login, an approved gateway and remote-memory consent are required.",
    );
    return ok;
  };
  const consent = async (granted: boolean) => {
    setConnected(false);
    setVersion((n) => n + 1);
    const r = await adapter.consent(granted);
    const ok = r.state === "ready" && r.data.granted;
    setConnected(ok);
    setNotice(
      r.state === "ready"
        ? ok
          ? "Remote memory access allowed for this owner session."
          : "Remote memory consent revoked."
        : "Consent change could not be confirmed. This tab is disconnected.",
    );
  };
  return (
    <Context.Provider
      value={{
        configured,
        connected,
        version,
        adapter,
        connect,
        consent,
        disconnect,
        notice,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function usePrivateMemory() {
  const v = useContext(Context);
  if (!v) throw Error("PrivateMemoryProvider required");
  return v;
}
