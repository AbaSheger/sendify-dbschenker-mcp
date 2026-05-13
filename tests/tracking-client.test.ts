import { describe, it, expect } from "vitest";
import {
  DbSchenkerClient,
  DbSchenkerPublicClient,
} from "../src/tracking-client.js";
import { HttpClient } from "../src/http.js";
import { TrackingError } from "../src/errors.js";
import { mockShipmentPayload } from "./fixtures.js";

/** Builds a fetch-shaped mock that returns the given Response factory. */
function mockFetch(handler: (url: string) => Response): typeof fetch {
  return (async (input: Request | string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url);
  }) as unknown as typeof fetch;
}

function makeClient(handler: (url: string) => Response): DbSchenkerClient {
  const http = new HttpClient(
    { timeoutMs: 1_000, maxRetries: 0 },
    mockFetch(handler),
  );
  return new DbSchenkerClient({
    endpointTemplate: "https://mock.example.com/tracking?ref={ref}",
    http,
  });
}

describe("DbSchenkerClient", () => {
  it("returns a parsed shipment for a successful response", async () => {
    const client = makeClient(
      () =>
        new Response(JSON.stringify(mockShipmentPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const shipment = await client.trackShipment("1806203236");
    expect(shipment.reference).toBe("1806203236");
    expect(shipment.shipmentId).toBe("SHP-0001");
    expect(shipment.sender.city).toBe("Goteborg");
    expect(shipment.trackingHistory.length).toBeGreaterThan(0);
  });

  it("maps 404 to NOT_FOUND", async () => {
    const client = makeClient(() => new Response("", { status: 404 }));
    await expect(client.trackShipment("missing")).rejects.toMatchObject({
      name: "TrackingError",
      code: "NOT_FOUND",
    });
  });

  it("maps 429 to RATE_LIMITED", async () => {
    const client = makeClient(() => new Response("", { status: 429 }));
    await expect(client.trackShipment("any")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("maps 500 to UPSTREAM_ERROR", async () => {
    const client = makeClient(() => new Response("", { status: 500 }));
    await expect(client.trackShipment("any")).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      status: 500,
    });
  });

  it("rejects empty and malformed references before hitting the network", async () => {
    let called = false;
    const client = makeClient(() => {
      called = true;
      return new Response("{}", { status: 200 });
    });
    await expect(client.trackShipment("   ")).rejects.toMatchObject({
      code: "INVALID_REFERENCE",
    });
    await expect(client.trackShipment("bad ref with spaces")).rejects.toMatchObject({
      code: "INVALID_REFERENCE",
    });
    expect(called).toBe(false);
  });

  it("treats unparseable JSON as PARSE_ERROR", async () => {
    const client = makeClient(
      () => new Response("not json at all", { status: 200 }),
    );
    await expect(client.trackShipment("any")).rejects.toMatchObject({
      code: "PARSE_ERROR",
    });
  });

  it("treats an empty 200 payload as NOT_FOUND", async () => {
    const client = makeClient(() => new Response("null", { status: 200 }));
    await expect(client.trackShipment("any")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("requires {ref} in the endpoint template", () => {
    expect(
      () =>
        new DbSchenkerClient({
          endpointTemplate: "https://example.com/no-placeholder",
        }),
    ).toThrow(TrackingError);
  });
});

describe("DbSchenkerPublicClient", () => {
  it("uses the current public search/details flow and returns structured shipment data", async () => {
    const http = new HttpClient(
      { timeoutMs: 1_000, maxRetries: 0 },
      mockFetch((url) => {
        if (url.includes("/shipments?query=1806203236")) {
          return new Response(
            JSON.stringify({
              result: [
                {
                  id: "LandStt:SENYB550963155",
                  stt: "SENYB550963155",
                  transportMode: "LAND",
                  lastEventCode: "PICKED_UP",
                  percentageProgress: 40,
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url.includes("/shipments/land/LandStt%3ASENYB550963155/trip")) {
          return new Response(
            JSON.stringify({ start: null, end: null, trip: [] }),
            {
              status: 200,
            },
          );
        }

        if (url.includes("/shipments/land/LandStt%3ASENYB550963155")) {
          return new Response(
            JSON.stringify({
              location: {
                shipper: {
                  companyName: "Sender AB",
                  cityName: "Stockholm",
                  zipCode: "11122",
                  countryCode: "SE",
                },
                consignee: {
                  companyName: "Receiver GmbH",
                  cityName: "Berlin",
                  zipCode: "10115",
                  countryCode: "DE",
                },
              },
              goods: {
                pieces: 2,
                weight: { value: 12.5, unit: "kg" },
                volume: { value: 0.4, unit: "m3" },
              },
              events: [
                {
                  code: "PICKED_UP",
                  date: "2026-05-10T08:00:00Z",
                  comment: "Picked up",
                  location: { name: "Stockholm", countryCode: "SE" },
                },
              ],
              packages: [
                {
                  id: "PKG-1",
                  events: [{ code: "PICKED_UP", date: "2026-05-10T08:00:00Z" }],
                },
              ],
            }),
            { status: 200 },
          );
        }

        return new Response("", { status: 404 });
      }),
    );
    const client = new DbSchenkerPublicClient({ http });
    const shipment = await client.trackShipment("1806203236");

    expect(shipment.sttNumber).toBe("SENYB550963155");
    expect(shipment.sender.name).toBe("Sender AB");
    expect(shipment.receiver.city).toBe("Berlin");
    expect(shipment.packageDetails.pieceCount).toBe(2);
    expect(shipment.packageDetails.totalWeightKg).toBe(12.5);
    expect(shipment.trackingHistory[0]?.status).toBe("PICKED_UP");
    expect(shipment.trackingHistory[0]?.description).toBe("Picked up");
    expect(shipment.trackingHistory[0]?.location).toBe("Stockholm");
    expect(shipment.packageEvents["PKG-1"]).toHaveLength(1);
  });
});
