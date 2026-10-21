import { parseSafeMarkdown } from "./markdown";
const worker = self as unknown as {
  onmessage: ((e: MessageEvent<{ source: string }>) => void) | null;
  postMessage: (data: unknown) => void;
};
worker.onmessage = ({ data }) => {
  try {
    worker.postMessage({ ok: true, document: parseSafeMarkdown(data.source) });
  } catch {
    worker.postMessage({ ok: false });
  }
};
