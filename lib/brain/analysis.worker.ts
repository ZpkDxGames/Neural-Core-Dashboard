import { classify } from "../graph";
import { extractConceptMentions } from "../concepts";
import type { Conversation } from "../types";
const worker = self as unknown as {
  onmessage: ((e: MessageEvent<{ items: Conversation[] }>) => void) | null;
  postMessage: (data: unknown) => void;
};
worker.onmessage = ({ data }) => {
  const categories: Record<string, number> = {},
    providers: Record<string, number> = {},
    byId: Record<string, string> = {},
    concepts = new Set<string>();
  let messages = 0;
  for (const c of data.items) {
    const category = classify(c);
    categories[category] = (categories[category] ?? 0) + 1;
    providers[c.provider] = (providers[c.provider] ?? 0) + 1;
    byId[c.id] = category;
    messages += c.messages.length;
    for (const hit of extractConceptMentions(c)) concepts.add(hit.id);
  }
  worker.postMessage({
    categories,
    providers,
    byId,
    messages,
    concepts: concepts.size,
  });
};
