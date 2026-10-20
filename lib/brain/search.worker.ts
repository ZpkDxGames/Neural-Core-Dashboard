import type { Conversation } from "../types";
const scope = self as unknown as {
  onmessage:
    | ((
        e: MessageEvent<{
          items?: Conversation[];
          query?: string;
          provider?: string;
          id: number;
        }>,
      ) => void)
    | null;
  postMessage: (message: unknown) => void;
};
let items: Conversation[] = [],
  generation = 0;
scope.onmessage = async ({ data }) => {
  if (data.items) {
    items = data.items;
    return;
  }
  const current = ++generation,
    q = (data.query ?? "").toLocaleLowerCase(),
    ids: string[] = [];
  let deadline = performance.now() + 6;
  for (let i = 0; i < items.length; i++) {
    if (current !== generation) return;
    const c = items[i]!;
    if (
      (!data.provider || c.provider === data.provider) &&
      (!q ||
        c.title.toLocaleLowerCase().includes(q) ||
        c.messages.some((m) => m.text.toLocaleLowerCase().includes(q)))
    )
      ids.push(c.id);
    if (performance.now() > deadline) {
      scope.postMessage({
        id: data.id,
        done: false,
        scanned: i + 1,
        total: items.length,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      deadline = performance.now() + 6;
    }
  }
  scope.postMessage({ id: data.id, done: true, ids, total: items.length });
};
