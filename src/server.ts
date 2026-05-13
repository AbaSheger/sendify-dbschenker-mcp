#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { TrackingError } from "./errors.js";
import { HttpClient } from "./http.js";
import { DbSchenkerClient, type TrackingClient } from "./tracking-client.js";
import { ShipmentSchema } from "./types.js";

const SERVER_NAME = "sendify-dbschenker-mcp";
const SERVER_VERSION = "1.0.0";

const debug = process.env["DEBUG"] === "1";
const logErr = (msg: string, extra?: unknown): void => {
  // stdout is reserved for MCP traffic; everything else goes to stderr.
  if (debug && extra !== undefined) {
    process.stderr.write(`[${SERVER_NAME}] ${msg} ${JSON.stringify(extra)}\n`);
  } else {
    process.stderr.write(`[${SERVER_NAME}] ${msg}\n`);
  }
};

/**
 * Build the MCP server. Extracted so tests can wire in a fake client
 * without going through process.env.
 */
export function buildServer(client: TrackingClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Tracks DB Schenker shipments. Call `track_shipment` with a reference number to retrieve sender, receiver, package details, and the full tracking history.",
    },
  );

  server.registerTool(
    "track_shipment",
    {
      title: "Track DB Schenker shipment",
      description:
        "Looks up a DB Schenker shipment by reference number on the public tracking endpoint. Returns sender, receiver, package details, and the full tracking history (including per-package events when available).",
      inputSchema: {
        reference: z
          .string()
          .min(1)
          .max(64)
          .describe("DB Schenker tracking reference number, e.g. 1806203236"),
      },
      outputSchema: ShipmentSchema.shape,
    },
    async ({ reference }) => {
      try {
        const shipment = await client.trackShipment(reference);
        return {
          content: [{ type: "text", text: JSON.stringify(shipment, null, 2) }],
          structuredContent: shipment,
        };
      } catch (err) {
        const tErr = toTrackingError(err);
        logErr(`track_shipment failed (${tErr.code}): ${tErr.message}`);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: false,
                  error: tErr.code,
                  message: tErr.message,
                  reference,
                  ...(tErr.status !== undefined
                    ? { upstreamStatus: tErr.status }
                    : {}),
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );

  return server;
}

function toTrackingError(err: unknown): TrackingError {
  if (err instanceof TrackingError) return err;
  return new TrackingError(
    "UPSTREAM_ERROR",
    err instanceof Error ? err.message : String(err),
    {
      cause: err,
    },
  );
}

function buildClientFromEnv(): TrackingClient {
  const endpoint = process.env["SCHENKER_TRACKING_URL"];
  const timeoutMs = parseIntEnv("SCHENKER_TIMEOUT_MS", 10_000);
  const maxRetries = parseIntEnv("SCHENKER_MAX_RETRIES", 2);

  const http = new HttpClient({ timeoutMs, maxRetries });
  if (endpoint && endpoint.trim() !== "") {
    return new DbSchenkerClient({ endpointTemplate: endpoint, http });
  }
  return DbSchenkerClient.withDefaultEndpoints({ http });
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main(): Promise<void> {
  const client = buildClientFromEnv();
  const server = buildServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logErr(`ready (stdio) - version ${SERVER_VERSION}`);
}

// Only run main when this file is executed directly, not when imported in tests.
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("server.js") === true ||
  process.argv[1]?.endsWith("server.ts") === true;

if (isDirectRun) {
  main().catch((err) => {
    logErr(`fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
