import { PanelBoundary } from "@/components/brain/PanelBoundary";
import { NoteReader } from "@/components/brain/Library";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ noteId: string }>;
  searchParams: Promise<{ demo?: string; tab?: string }>;
}) {
  const [p, q] = await Promise.all([params, searchParams]);
  return (
    <PanelBoundary>
      <NoteReader id={p.noteId} demo={q.demo === "1"} tab={q.tab} />
    </PanelBoundary>
  );
}
