export const LEGACY_VIEWS = {
  overview: "/",
  network: "/graph",
  memories: "/library?collection=local",
  insights: "/?section=topics",
  sources: "/sources",
  settings: "/settings",
} as const;
export function legacyDestination(
  view: string,
  params: Record<string, string | string[] | undefined>,
): string | null {
  if (!Object.hasOwn(LEGACY_VIEWS, view)) return null;
  const target = new URL(
    LEGACY_VIEWS[view as keyof typeof LEGACY_VIEWS],
    "http://local",
  );
  for (const [key, value] of Object.entries(params))
    if (key !== "view" && value !== undefined) {
      for (const v of Array.isArray(value) ? value : [value])
        target.searchParams.append(key, v);
    }
  return target.pathname + target.search;
}
