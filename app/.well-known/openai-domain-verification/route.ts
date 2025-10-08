const token =
  process.env.OPENAI_DOMAIN_VERIFICATION_TOKEN?.trim() ??
  process.env.NEXT_PUBLIC_OPENAI_DOMAIN_VERIFICATION_TOKEN?.trim() ??
  "";

export function GET(): Response {
  if (!token) {
    return new Response("Verification token is not configured", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(`openai-domain-verification=${token}`.trim(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, must-revalidate",
    },
  });
}
