import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";
import { TrackingError } from "../src/errors.js";
import type { TrackingClient } from "../src/tracking-client.js";
import type { Shipment } from "../src/types.js";
import { mockShipmentPayload } from "./fixtures.js";
import { parseShipment } from "../src/parser.js";

function fakeClient(
  impl: (reference: string) => Promise<Shipment>,
): TrackingClient {
  return { trackShipment: impl };
}

describe("MCP server tool handler", () => {
  it("returns structured shipment content on success", async () => {
    const happy = parseShipment(mockShipmentPayload, { reference: "1806203236" });
    if (!happy) throw new Error("fixture should parse");

    const server = buildServer(fakeClient(async () => happy));

    // Reach into the registered tool to invoke its handler directly. We
    // don't spin up a real MCP transport for unit tests; the SDK's own
    // tests already cover the transport layer.
    const tool = getRegisteredTool(server, "track_shipment");
    expect(tool).toBeDefined();

    const result = await tool.handler({ reference: "1806203236" }, {});
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent.shipmentId).toBe("SHP-0001");
  });

  it("returns a structured error result when the client throws", async () => {
    const server = buildServer(
      fakeClient(async () => {
        throw new TrackingError("NOT_FOUND", "no such shipment");
      }),
    );
    const tool = getRegisteredTool(server, "track_shipment");
    const result = await tool.handler({ reference: "missing" }, {});
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("NOT_FOUND");
    expect(parsed.reference).toBe("missing");
  });
});

interface RegisteredToolLike {
  handler: (args: unknown, extra: unknown) => Promise<{
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
    structuredContent?: Record<string, unknown>;
  }>;
}

function getRegisteredTool(server: unknown, name: string): RegisteredToolLike {
  const tools = (server as { _registeredTools: Record<string, RegisteredToolLike> })
    ._registeredTools;
  const tool = tools[name];
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return tool;
}
