import { Graph } from "@/components/brain/graph/Graph";
import { PanelBoundary } from "@/components/brain/PanelBoundary";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string; focus?: string; mode?: string }>;
}) {
  const p = await searchParams;
  return (
    <PanelBoundary>
      <Graph demo={p.demo === "1"} focus={p.focus} initialMode={p.mode} />
    </PanelBoundary>
  );
}
