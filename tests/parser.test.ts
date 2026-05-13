import { describe, it, expect } from "vitest";
import { parseShipment } from "../src/parser.js";
import { ShipmentSchema } from "../src/types.js";
import { mockShipmentPayload } from "./fixtures.js";

describe("parseShipment", () => {
  it("extracts the documented fields from a well-formed payload", () => {
    const result = parseShipment(mockShipmentPayload, {
      reference: "1806203236",
    });
    expect(result).not.toBeNull();
    const parsed = ShipmentSchema.parse(result);

    expect(parsed.reference).toBe("1806203236");
    expect(parsed.shipmentId).toBe("SHP-0001");
    expect(parsed.sttNumber).toBe("STT-12345");
    expect(parsed.transportMode).toBe("LAND");

    expect(parsed.sender.city).toBe("Goteborg");
    expect(parsed.receiver.country).toBe("DE");

    expect(parsed.packageDetails.pieceCount).toBe(3);
    expect(parsed.packageDetails.totalWeightKg).toBe(47.5);

    expect(parsed.trackingHistory).toHaveLength(2);
    expect(parsed.trackingHistory[0]?.status).toBe("PICKED_UP");

    expect(parsed.packageEvents["PKG-1"]).toHaveLength(1);
  });

  it("falls back to nulls when fields are missing", () => {
    const result = parseShipment(
      { data: { sender: {}, receiver: {} } },
      { reference: "x" },
    );
    expect(result).not.toBeNull();
    const parsed = ShipmentSchema.parse(result);
    expect(parsed.sender.name).toBeNull();
    expect(parsed.packageDetails.pieceCount).toBeNull();
    expect(parsed.trackingHistory).toEqual([]);
    expect(parsed.packageEvents).toEqual({});
  });

  it("handles alternate field names (consignor/consignee/events)", () => {
    const payload = {
      shipment: {
        consignor: { name: "X", city: "Stockholm" },
        consignee: { name: "Y", city: "Oslo" },
        events: [{ time: "2026-01-01", code: "OK", message: "done" }],
      },
    };
    const result = parseShipment(payload, { reference: "alt" });
    expect(result).not.toBeNull();
    expect(result?.sender.name).toBe("X");
    expect(result?.receiver.name).toBe("Y");
    expect(result?.trackingHistory).toHaveLength(1);
    expect(result?.trackingHistory[0]?.timestamp).toBe("2026-01-01");
  });

  it("returns null for unparseable input", () => {
    expect(parseShipment("not an object", { reference: "x" })).toBeNull();
    expect(parseShipment(null, { reference: "x" })).toBeNull();
    expect(parseShipment(42, { reference: "x" })).toBeNull();
  });

  it("unwraps payload nested under 'shipments[0]'", () => {
    const payload = {
      shipments: [
        { id: "A", sender: { name: "S" }, receiver: { name: "R" } },
        { id: "B", sender: {}, receiver: {} },
      ],
    };
    const result = parseShipment(payload, { reference: "x" });
    expect(result?.shipmentId).toBe("A");
  });
});
