import { Activity } from "@/components/brain/Activity";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  return <Activity tab={(await searchParams).tab} />;
}
