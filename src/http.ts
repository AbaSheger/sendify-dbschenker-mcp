import { TrackingError } from "./errors.js";
import {
  cookieFromSetCookie,
  getCaptchaPuzzle,
  hasCaptchaPuzzle,
  solveCaptchaPuzzle,
} from "./captcha.js";

export interface HttpClientOptions {
  timeoutMs?: number;
  maxRetries?: number;
  userAgent?: string;
}

export interface HttpResponse {
  status: number;
  body: string;
  contentType: string | null;
}

const DEFAULT_USER_AGENT =
  "sendify-dbschenker-mcp/1.0 (+https://github.com/AbaSheger/sendify-dbschenker-mcp)";

/**
 * Thin wrapper around `fetch` that:
 *   - applies a timeout via AbortController
 *   - retries idempotent GETs with exponential backoff
 *   - translates network/HTTP failures into typed `TrackingError`s
 *
 * Kept deliberately small so it is easy to mock in tests by injecting a
 * different `fetchImpl`.
 */
export class HttpClient {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    options: HttpClientOptions = {},
    fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = fetchImpl;
  }

  async getJson(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<HttpResponse> {
    let attempt = 0;
    let lastError: TrackingError | undefined;

    while (attempt <= this.maxRetries) {
      try {
        return await this.requestOnce(url, headers);
      } catch (err) {
        const tErr =
          err instanceof TrackingError
            ? err
            : new TrackingError("NETWORK_ERROR", String(err), { cause: err });
        lastError = tErr;
        if (!tErr.isRetryable() || attempt === this.maxRetries) {
          throw tErr;
        }
        await sleep(backoffMs(attempt));
        attempt++;
      }
    }

    // Defensive: the loop above always either returns or throws.
    throw lastError ?? new TrackingError("NETWORK_ERROR", "request failed");
  }

  private async requestOnce(
    url: string,
    headers: Record<string, string>,
  ): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const requestHeaders = {
        Accept: "application/json",
        "User-Agent": this.userAgent,
        ...headers,
      };

      const res = await this.fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        headers: requestHeaders,
      });

      const captchaResponse = await this.retryWithCaptchaSolution(
        url,
        res,
        requestHeaders,
        controller.signal,
      );
      if (captchaResponse) return captchaResponse;

      const body = await res.text();
      const contentType = res.headers.get("content-type");

      if (res.status === 429) {
        throw new TrackingError(
          "RATE_LIMITED",
          "upstream rate-limited the request",
          {
            status: 429,
          },
        );
      }
      if (res.status === 404) {
        throw new TrackingError("NOT_FOUND", "shipment not found", {
          status: 404,
        });
      }
      if (res.status >= 500) {
        throw new TrackingError(
          "UPSTREAM_ERROR",
          `upstream returned ${res.status}`,
          {
            status: res.status,
          },
        );
      }
      if (res.status >= 400) {
        throw new TrackingError(
          "UPSTREAM_ERROR",
          `upstream returned ${res.status}`,
          {
            status: res.status,
          },
        );
      }

      return { status: res.status, body, contentType };
    } catch (err) {
      if (err instanceof TrackingError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new TrackingError(
          "TIMEOUT",
          `request timed out after ${this.timeoutMs}ms`,
          {
            cause: err,
          },
        );
      }
      throw new TrackingError("NETWORK_ERROR", String(err), { cause: err });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async retryWithCaptchaSolution(
    url: string,
    res: Response,
    requestHeaders: Record<string, string>,
    signal: AbortSignal,
  ): Promise<HttpResponse | null> {
    const puzzle = getCaptchaPuzzle(res.headers);
    if (res.status !== 429 || !puzzle) return null;

    let solution: string;
    try {
      solution = await solveCaptchaPuzzle(puzzle);
    } catch (err) {
      throw new TrackingError(
        "CAPTCHA_REQUIRED",
        "upstream CAPTCHA could not be solved",
        {
          status: 429,
          cause: err,
        },
      );
    }

    const cookie = cookieFromSetCookie(res.headers);
    const retryHeaders = {
      ...requestHeaders,
      "Captcha-Solution": solution,
      ...(cookie ? { Cookie: cookie } : {}),
    };

    const retryRes = await this.fetchImpl(url, {
      method: "GET",
      signal,
      headers: retryHeaders,
    });
    const body = await retryRes.text();
    const contentType = retryRes.headers.get("content-type");

    if (retryRes.status === 422) {
      throw new TrackingError(
        "CAPTCHA_SOLUTION_INVALID",
        "upstream rejected the CAPTCHA solution",
        { status: 422 },
      );
    }
    if (retryRes.status === 429 && hasCaptchaPuzzle(retryRes.headers)) {
      throw new TrackingError(
        "CAPTCHA_REQUIRED",
        "upstream still requires a fresh CAPTCHA solution",
        { status: 429 },
      );
    }
    if (retryRes.status === 404) {
      throw new TrackingError("NOT_FOUND", "shipment not found", {
        status: 404,
      });
    }
    if (retryRes.status >= 500) {
      throw new TrackingError(
        "UPSTREAM_ERROR",
        `upstream returned ${retryRes.status}`,
        {
          status: retryRes.status,
        },
      );
    }
    if (retryRes.status >= 400) {
      throw new TrackingError(
        "UPSTREAM_ERROR",
        `upstream returned ${retryRes.status}`,
        {
          status: retryRes.status,
        },
      );
    }

    return { status: retryRes.status, body, contentType };
  }
}

function backoffMs(attempt: number): number {
  // 200, 400, 800, ... with a small jitter
  const base = 200 * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 100);
  return base + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
