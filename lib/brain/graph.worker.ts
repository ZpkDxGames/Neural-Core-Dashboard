import { projectGraph } from "./graph-data";
import { layoutGraph } from "./layout";
import type { Conversation } from "../types";
const worker = self as unknown as {
  onmessage:
    | ((
        e: MessageEvent<{
          items: Conversation[];
          demo: boolean;
          total: number;
          focus?: string;
        }>,
      ) => void)
    | null;
  postMessage: (data: unknown, transfer?: Transferable[]) => void;
};
worker.onmessage = ({ data }) => {
  try {
    const start = performance.now(),
      graph = projectGraph(data.items, data.demo, data.total, data.focus),
      positions = layoutGraph(graph);
    worker.postMessage(
      { ok: true, graph, positions, layoutMs: performance.now() - start },
      [positions.buffer],
    );
  } catch {
    worker.postMessage({ ok: false });
  }
};
