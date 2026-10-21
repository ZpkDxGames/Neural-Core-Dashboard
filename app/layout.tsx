import type { Metadata } from "next";
import "./globals.css";
import "./styles/tokens.css";
import { BrainProvider } from "@/components/brain/BrainProvider";
import { Shell } from "@/components/brain/Shell";
export const metadata: Metadata = {
  title: "Neural Brain | Knowledge Workspace",
  description:
    "An independent, private, local-first knowledge network for AI conversations.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <BrainProvider>
          <Shell>{children}</Shell>
        </BrainProvider>
      </body>
    </html>
  );
}
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};
