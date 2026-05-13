import { createHash } from "node:crypto";

interface CaptchaPuzzle {
  jwt: string;
  bytes: Uint8Array;
}

interface CaptchaSolution {
  jwt: string;
  solution: string;
}

export function hasCaptchaPuzzle(headers: Headers): boolean {
  return getCaptchaPuzzle(headers) !== null;
}

export function getCaptchaPuzzle(headers: Headers): string | null {
  return (
    headers.get("Captcha-Puzzle") ??
    headers.get("captcha-puzzle") ??
    headers.get("X-Captcha-Puzzle")
  );
}

export function cookieFromSetCookie(headers: Headers): string | null {
  const setCookie = headers.get("set-cookie");
  if (!setCookie) return null;

  const firstCookie = setCookie.split(",").find((part) => part.includes("="));
  const pair = firstCookie?.split(";")[0]?.trim();
  return pair || null;
}

export async function solveCaptchaPuzzle(header: string): Promise<string> {
  const puzzles = parsePuzzleHeader(header);
  if (puzzles.length === 0) {
    throw new Error("Captcha-Puzzle header did not contain any puzzles");
  }

  const solutions: CaptchaSolution[] = await Promise.all(
    puzzles.map(async ({ jwt, bytes }) => ({
      jwt,
      solution: Buffer.from(await solveProofOfWork(bytes)).toString("base64"),
    })),
  );

  return Buffer.from(JSON.stringify(solutions), "utf8").toString("base64");
}

function parsePuzzleHeader(header: string): CaptchaPuzzle[] {
  const decoded = Buffer.from(header, "base64").toString("utf8");
  return decoded
    .split(",")
    .map((jwt) => jwt.trim())
    .filter(Boolean)
    .map((jwt) => {
      const payload = parseJwtPayload(jwt);
      const puzzle = payload["puzzle"];
      if (typeof puzzle !== "string") {
        throw new Error("captcha JWT payload is missing puzzle");
      }
      return { jwt, bytes: Buffer.from(puzzle, "base64") };
    });
}

function parseJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || !payload) {
    throw new Error("invalid captcha JWT format");
  }
  return JSON.parse(
    Buffer.from(fromBase64Url(payload), "base64").toString("utf8"),
  ) as Record<string, unknown>;
}

function fromBase64Url(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
}

async function solveProofOfWork(puzzle: Uint8Array): Promise<Uint8Array> {
  if (puzzle.length < 32) {
    throw new Error("captcha puzzle is too short");
  }

  const target = captchaTarget(puzzle);
  for (let nonce = 0; nonce <= Number.MAX_SAFE_INTEGER; nonce++) {
    const nonceBytes = nonceToBytes(nonce);
    if (hashPuzzle(puzzle, nonceBytes) < target) {
      return nonceBytes;
    }
    if (nonce % 2_000 === 0) {
      await Promise.resolve();
    }
  }

  throw new Error("captcha proof-of-work search exhausted");
}

function captchaTarget(puzzle: Uint8Array): bigint {
  const exponentByte = puzzle[13];
  const multiplierByte = puzzle[14];
  if (
    exponentByte === undefined ||
    multiplierByte === undefined ||
    exponentByte < 3
  ) {
    throw new Error("captcha puzzle has invalid target bytes");
  }
  return BigInt(multiplierByte) << BigInt(8 * (exponentByte - 3));
}

function nonceToBytes(nonce: number): Uint8Array {
  const out = new Uint8Array(8);
  let value = nonce;
  for (let i = 0; i < out.length; i++) {
    out[i] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return out;
}

function hashPuzzle(puzzle: Uint8Array, nonce: Uint8Array): bigint {
  const input = Buffer.concat([
    Buffer.from(puzzle.subarray(0, 32)),
    Buffer.from(nonce),
  ]);
  const first = createHash("sha256").update(input).digest();
  const second = createHash("sha256").update(first).digest();

  let value = 0n;
  for (let i = second.length - 1; i >= 0; i--) {
    value = value * 256n + BigInt(second[i] ?? 0);
  }
  return value;
}
