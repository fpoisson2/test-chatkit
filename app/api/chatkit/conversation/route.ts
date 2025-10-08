const DEFAULT_CHATKIT_BASE = "https://api.openai.com";

export const runtime = "edge";

export async function POST(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed();
  }

  try {
    const apiBase = process.env.CHATKIT_API_BASE ?? DEFAULT_CHATKIT_BASE;
    const upstreamUrl = `${apiBase}/v1/chatkit/conversation`;

    const bodyText = await request.text();
    const upstreamHeaders = new Headers();

    request.headers.forEach((value, key) => {
      if (key.toLowerCase() === "host" || key.toLowerCase() === "content-length") {
        return;
      }
      upstreamHeaders.set(key, value);
    });

    if (!upstreamHeaders.has("authorization")) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return buildJsonResponse(
          { error: "Missing credentials for ChatKit conversation forwarding." },
          500
        );
      }
      upstreamHeaders.set("Authorization", `Bearer ${apiKey}`);
    }

    if (!upstreamHeaders.has("openai-beta")) {
      upstreamHeaders.set("OpenAI-Beta", "chatkit_beta=v1");
    }

    if (!upstreamHeaders.has("content-type") && bodyText) {
      upstreamHeaders.set("Content-Type", "application/json");
    }

    const upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: bodyText || undefined,
    });

    const responseHeaders = filterResponseHeaders(upstreamResponse.headers);
    const responseBody = upstreamResponse.body;

    if (!responseBody) {
      const fallbackText = await upstreamResponse.text();
      return new Response(fallbackText, {
        status: upstreamResponse.status,
        headers: responseHeaders,
      });
    }

    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[chatkit-conversation] forwarding failed", error);
    return buildJsonResponse({ error: "Failed to forward ChatKit conversation request." }, 500);
  }
}

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export async function OPTIONS(): Promise<Response> {
  return methodNotAllowed();
}

function filterResponseHeaders(headers: Headers): Headers {
  const filtered = new Headers();
  copyHeaderIfPresent(headers, filtered, "content-type", "Content-Type");
  copyHeaderIfPresent(headers, filtered, "cache-control", "Cache-Control");
  copyHeaderIfPresent(headers, filtered, "connection", "Connection");
  return filtered;
}

function copyHeaderIfPresent(
  source: Headers,
  target: Headers,
  name: string,
  overrideName?: string
): void {
  const value = source.get(name);
  if (value) {
    target.set(overrideName ?? name, value);
  }
}

function buildJsonResponse(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function methodNotAllowed(): Response {
  return buildJsonResponse({ error: "Method Not Allowed" }, 405);
}
