/**
 * Synthetic payload that matches the kind of shape we expect from the public
 * tracking endpoint. Keep this fixture local and deterministic; live endpoint
 * checks belong in manual verification because the upstream can rate-limit.
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
      city: "Goteborg",
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
        location: "Goteborg",
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
            location: "Goteborg",
            packageId: "PKG-1",
          },
        ],
      },
    ],
  },
};
