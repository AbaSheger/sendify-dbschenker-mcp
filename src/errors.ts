/**
 * Error types raised by the tracking client.
 *
 * Each error carries a stable `code` so the MCP server can translate it
 * into a structured response that an LLM (or downstream caller) can act on.
 */

export type TrackingErrorCode =
  | "INVALID_REFERENCE"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "PARSE_ERROR"
  | "CONFIG_ERROR"
  | "CAPTCHA_REQUIRED"
  | "CAPTCHA_SOLUTION_INVALID";

export class TrackingError extends Error {
  public readonly code: TrackingErrorCode;
  public readonly status?: number;
  public override readonly cause?: unknown;

  constructor(
    code: TrackingErrorCode,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "TrackingError";
    this.code = code;
    this.status = options.status;
    this.cause = options.cause;
  }

  /** True if the caller can usefully retry the same request. */
  isRetryable(): boolean {
    return (
      this.code === "RATE_LIMITED" ||
      this.code === "NETWORK_ERROR" ||
      this.code === "TIMEOUT" ||
      (this.code === "UPSTREAM_ERROR" && (this.status ?? 0) >= 500)
    );
  }
}
