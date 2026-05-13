/**
 * Synthetic payload that matches the shape we expect from the public
 * tracking endpoint. The field names below are based on the patterns
 * documented in the parser (sender, receiver, packageDetails, events).
 *
 * If the real upstream payload uses different names, extend the candidate
 * paths in src/parser.ts rather than changing tests, so the parser stays
 * tolerant of shape drift.
 */
export const mockShipmentPayload = {
  data: {
    id: "SHP-0001",
    stt: "STT-12345",
    transportMode: "LAND",
    status: "IN_TRANSIT",
    estimatedDelivery: "2026-05-15T10:00:00Z",
    sender: {
      name: "Acme AB",
      street: "Storgatan 1",
      city: "Göteborg",
      postalCode: "41115",
      country: "SE",
    },
    receiver: {
      name: "Beta GmbH",
      street: "Hauptstrasse 42",
      city: "Berlin",
      postalCode: "10115",
      country: "DE",
    },
    packageDetails: {
      pieceCount: 3,
      totalWeightKg: 47.5,
      totalVolumeM3: 0.85,
      loadingMeters: 0.4,
      goodsDescription: "Spare parts",
    },
    trackingHistory: [
      {
        timestamp: "2026-05-10T08:00:00Z",
        status: "PICKED_UP",
        description: "Shipment picked up at sender",
        location: "Göteborg",
        packageId: null,
      },
      {
        timestamp: "2026-05-11T22:15:00Z",
        status: "IN_TRANSIT",
        description: "Departed terminal",
        location: "Hamburg",
        packageId: null,
      },
    ],
    packages: [
      {
        packageId: "PKG-1",
        events: [
          {
            timestamp: "2026-05-10T08:00:00Z",
            status: "PICKED_UP",
            description: "Picked up",
            location: "Göteborg",
            packageId: "PKG-1",
          },
        ],
      },
    ],
  },
};
