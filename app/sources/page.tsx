import { Sources } from "@/components/brain/Sources";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const p = await searchParams;
  return <Sources tab={p.tab} />;
}
