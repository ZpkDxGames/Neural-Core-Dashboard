import { permanentRedirect } from "next/navigation";
import { Overview } from "@/components/brain/Overview";
import { legacyDestination } from "@/lib/brain/legacy-views";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  if (typeof params.view === "string") {
    const destination = legacyDestination(params.view, params);
    if (destination) permanentRedirect(destination);
  }
  if (typeof params.auth === "string")
    permanentRedirect("/settings?auth=" + encodeURIComponent(params.auth));
  return <Overview moved={typeof params.view === "string"} />;
}
