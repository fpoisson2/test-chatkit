const HOSTED_CONVERSATION_URL = "https://api.openai.com/v1/chatkit/conversation";
const PROXY_ENDPOINT = "/api/chatkit/conversation";

const PROXY_FLAG = "__chatkitConversationProxyInstalled";

type ExtendedWindow = Window & {
  [PROXY_FLAG]?: boolean;
};

const isBrowser = typeof window !== "undefined";

export function installChatKitConversationProxy(): () => void {
  if (!isBrowser) {
    return () => {};
  }

  const win = window as ExtendedWindow;
  if (win[PROXY_FLAG]) {
    return () => {};
  }

  const originalFetch = window.fetch.bind(window);

  const proxiedFetch: typeof window.fetch = (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    let request: Request;
    try {
      request =
        input instanceof Request ? input : new Request(input, init);
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[ChatKitPanel] Unable to inspect fetch request, falling back to original fetch",
          error
        );
      }
      return originalFetch(input as RequestInfo | URL, init);
    }

    if (shouldProxyConversationRequest(request.url)) {
      return proxyConversationRequest(request, originalFetch);
    }

    return originalFetch(input as RequestInfo | URL, init);
  };

  window.fetch = proxiedFetch;
  win[PROXY_FLAG] = true;

  return () => {
    if (!isBrowser) {
      return;
    }

    const currentWindow = window as ExtendedWindow;
    if (currentWindow[PROXY_FLAG]) {
      window.fetch = originalFetch;
      currentWindow[PROXY_FLAG] = false;
    }
  };
}

function shouldProxyConversationRequest(url: string): boolean {
  if (!url) {
    return false;
  }

  try {
    const resolved = new URL(url, window.location.origin);
    const target = resolved.origin + resolved.pathname;
    const hosted = new URL(HOSTED_CONVERSATION_URL);
    const hostedTarget = hosted.origin + hosted.pathname;
    return target === hostedTarget;
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[ChatKitPanel] Failed to parse request URL when evaluating proxy",
        { url, error }
      );
    }
    return false;
  }
}

async function proxyConversationRequest(
  request: Request,
  originalFetch: typeof fetch
): Promise<Response> {
  const cloned = request.clone();

  const headers = new Headers(cloned.headers);
  headers.delete("host");
  headers.delete("content-length");

  if (!headers.has("content-type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("openai-beta")) {
    headers.set("OpenAI-Beta", "chatkit_beta=v1");
  }

  const init: RequestInit = {
    method: cloned.method,
    headers,
    cache: cloned.cache,
    credentials: cloned.credentials,
    integrity: cloned.integrity,
    keepalive: cloned.keepalive,
    redirect: cloned.redirect,
    referrer: cloned.referrer === "about:client" ? undefined : cloned.referrer,
    referrerPolicy: cloned.referrerPolicy,
    signal: cloned.signal,
  };

  if (cloned.method !== "GET" && cloned.method !== "HEAD") {
    const bodyText = await cloned.text();
    init.body = bodyText;
  }

  if (process.env.NODE_ENV !== "production") {
    console.info("[ChatKitPanel] Proxying conversation request to backend");
  }

  return originalFetch(PROXY_ENDPOINT, init);
}
