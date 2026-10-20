import { parseArchive } from "../archive";
type Request = { file: File };
const worker = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage: (data: unknown) => void;
};
worker.onmessage = async ({ data }) => {
  try {
    if (data.file.size > 32 * 1024 * 1024) throw Error("FILE_TOO_LARGE");
    const parsed = parseArchive(JSON.parse(await data.file.text()));
    const unique = [
      ...new Map(parsed.conversations.map((c) => [c.id, c])).values(),
    ];
    worker.postMessage({
      ok: true,
      result: {
        ...parsed,
        conversations: unique,
        duplicatesWithinFile: parsed.conversations.length - unique.length,
      },
    });
  } catch (e) {
    worker.postMessage({
      ok: false,
      code:
        e instanceof Error && e.message === "FILE_TOO_LARGE"
          ? "FILE_TOO_LARGE"
          : "INVALID_ARCHIVE",
    });
  }
};
