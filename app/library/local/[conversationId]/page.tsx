import { Library } from "@/components/brain/Library";
export default async function Page({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  return (
    <Library selectedId={decodeURIComponent((await params).conversationId)} />
  );
}
