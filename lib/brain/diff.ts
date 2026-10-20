export type DiffLine = { kind: "same" | "added" | "removed"; text: string };
/** Bounded line LCS for review excerpts. Large inputs fail explicitly, never run quadratic work unbounded. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n"),
    b = after.split("\n");
  if (a.length > 500 || b.length > 500 || before.length + after.length > 100000)
    throw Error("DIFF_BUDGET_EXCEEDED");
  const width = b.length + 1,
    table = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * width + j] =
        a[i]! === b[j]!
          ? 1 + table[(i + 1) * width + j + 1]!
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
  const result: DiffLine[] = [];
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i]! === b[j]!) {
      result.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (
      j < b.length &&
      (i === a.length ||
        table[i * width + j + 1]! >= table[(i + 1) * width + j]!)
    ) {
      result.push({ kind: "added", text: b[j++]! });
    } else result.push({ kind: "removed", text: a[i++]! });
  }
  return result;
}
export type DraftState =
  | "editing"
  | "queued-local"
  | "sending"
  | "accepted"
  | "publishing"
  | "committed"
  | "failed"
  | "conflict";
export type DraftEvent =
  | { kind: "edit" | "queue" | "send" }
  | {
      kind: "ack";
      state: "accepted" | "publishing" | "committed" | "failed" | "conflict";
      confirmedAt: string;
    };
export function reduceDraft(state: DraftState, event: DraftEvent): DraftState {
  if (event.kind === "edit") return "editing";
  if (event.kind === "queue") return "queued-local";
  if (event.kind === "send")
    return state === "queued-local" ? "sending" : state;
  if (event.kind !== "ack") return state;
  if (!Number.isFinite(Date.parse(event.confirmedAt)))
    throw Error("CONFIRMED_ACK_REQUIRED");
  return event.state;
}
