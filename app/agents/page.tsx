import { Agents } from "@/components/brain/Agents";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  return <Agents tab={(await searchParams).tab} />;
}
