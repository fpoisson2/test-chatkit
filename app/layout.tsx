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

const defaultChatKitScriptSrc =
  "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js";
const defaultChatKitIframeOrigin = "https://chatkit.ve2fpd.com";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const chatKitScriptSrc =
    process.env.NEXT_PUBLIC_CHATKIT_SCRIPT_URL?.trim() ??
    defaultChatKitScriptSrc;
  const chatKitIframeOrigin =
    process.env.NEXT_PUBLIC_CHATKIT_IFRAME_ORIGIN?.trim() ??
    defaultChatKitIframeOrigin;
  let resolvedIframeOrigin = defaultChatKitIframeOrigin;
  try {
    resolvedIframeOrigin = new URL(chatKitIframeOrigin).origin;
  } catch (error) {
    console.warn("[ChatKit] Invalid iframe origin configured", error);
    resolvedIframeOrigin = new URL(defaultChatKitIframeOrigin).origin;
  }
  const chatKitCdnOrigin = new URL(defaultChatKitScriptSrc).origin;
  const chatKitIndexPrefix = "/deployments/chatkit/index-";
  const chatKitUrlInterceptor = `(() => {
    const CDN_ORIGIN = ${JSON.stringify(chatKitCdnOrigin)};
    const TARGET_ORIGIN = ${JSON.stringify(resolvedIframeOrigin)};
    const INDEX_PREFIX = ${JSON.stringify(chatKitIndexPrefix)};
    const ORIGINAL_URL = window.URL;
    if (typeof ORIGINAL_URL !== "function") {
      return;
    }
    const replaceIfChatKitIndex = (value) => {
      try {
        if (typeof value !== "string" || !value.includes(INDEX_PREFIX)) {
          return value;
        }
        const parsed = new ORIGINAL_URL(value, window.location.href);
        if (parsed.origin !== CDN_ORIGIN) {
          return value;
        }
        return value.replace(parsed.origin, TARGET_ORIGIN);
      } catch (error) {
        console.warn("[ChatKit] Failed to adjust iframe URL", error);
        return value;
      }
    };
    function URLInterceptor(value, base) {
      const resolved = replaceIfChatKitIndex(value);
      if (typeof base !== "undefined") {
        return new ORIGINAL_URL(resolved, base);
      }
      return new ORIGINAL_URL(resolved);
    }
    URLInterceptor.prototype = ORIGINAL_URL.prototype;
    Object.setPrototypeOf(URLInterceptor, ORIGINAL_URL);
    window.URL = URLInterceptor;
    const restore = () => {
      window.URL = ORIGINAL_URL;
      window.removeEventListener("chatkit-script-loaded", restore);
      window.removeEventListener("chatkit-script-error", restore);
    };
    window.addEventListener("chatkit-script-loaded", restore);
    window.addEventListener("chatkit-script-error", restore);
  })();`;
  return (
    <html lang="en">
      <head>
        <Script
          id="chatkit-iframe-origin-overrides"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: chatKitUrlInterceptor }}
        />
        <Script
          src={chatKitScriptSrc}
          strategy="beforeInteractive"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
