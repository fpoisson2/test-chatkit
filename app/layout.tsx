import Script from "next/script";
import type { Metadata } from "next";
import "./globals.css";

const openAIDomainVerificationToken =
  process.env.OPENAI_DOMAIN_VERIFICATION_TOKEN?.trim() ??
  process.env.NEXT_PUBLIC_OPENAI_DOMAIN_VERIFICATION_TOKEN?.trim() ??
  "";

export const metadata: Metadata = {
  title: "AgentKit demo",
  description: "Demo of ChatKit with hosted workflow",
  ...(openAIDomainVerificationToken
    ? {
        other: {
          "openai-domain-verification": openAIDomainVerificationToken,
        },
      }
    : {}),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const chatKitScriptSrc =
    process.env.NEXT_PUBLIC_CHATKIT_SCRIPT_URL?.trim() ??
    "https://chatkit.ve2fpd.com/deployments/chatkit/chatkit.js";
  return (
    <html lang="en">
      <head>
        <Script
          src={chatKitScriptSrc}
          strategy="beforeInteractive"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
