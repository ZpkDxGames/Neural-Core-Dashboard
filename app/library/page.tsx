import { Library } from "@/components/brain/Library";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string; demo?: string }>;
}) {
  const p = await searchParams;
  return <Library collection={p.collection} demo={p.demo === "1"} />;
}
