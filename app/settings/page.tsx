import { Settings } from "@/components/brain/Settings";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  return <Settings tab={(await searchParams).tab} />;
}
