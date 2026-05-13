import { describe, expect, it } from "vitest";
import { HttpClient } from "../src/http.js";

function captchaPuzzleHeader(): string {
  const puzzle = new Uint8Array(64);
  puzzle[13] = 33;
  puzzle[14] = 255;
  const payload = base64Url(
    JSON.stringify({
      puzzle: Buffer.from(puzzle).toString("base64"),
      iat: 1,
      exp: 9_999_999_999,
    }),
  );
  const jwt = `${base64Url(JSON.stringify({ alg: "HS256" }))}.${payload}.signature`;
  return Buffer.from(jwt, "utf8").toString("base64");
}

function base64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("HttpClient", () => {
  it("solves CAPTCHA puzzle responses and retries with solution and cookie", async () => {
    let calls = 0;
    const fetchImpl = (async (
      _input: Request | string | URL,
      init?: RequestInit,
    ) => {
      calls++;
      if (calls === 1) {
        return new Response("", {
          status: 429,
          headers: {
            "Captcha-Puzzle": captchaPuzzleHeader(),
            "Set-Cookie": "INGRESSCOOKIE=abc123; Path=/nges-portal/api; Secure",
          },
        });
      }

      const headers = init?.headers as Record<string, string>;
      expect(headers["Captcha-Solution"]).toBeTruthy();
      expect(headers["Cookie"]).toBe("INGRESSCOOKIE=abc123");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = new HttpClient({ maxRetries: 0 }, fetchImpl);
    const response = await client.getJson("https://example.test");
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(calls).toBe(2);
  });
});
