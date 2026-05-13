import {
  type Shipment,
  type Address,
  type PackageDetails,
  type TrackingEvent,
} from "./types.js";

/**
 * The DB Schenker public tracking endpoint is undocumented and its payload
 * shape may shift over time. We therefore parse defensively:
 *
 *   - look up each output field through a small list of candidate paths
 *   - fall back to null when nothing matches
 *   - never throw on a missing field; only throw if the payload is so
 *     malformed that we cannot identify a shipment at all
 *
 * The candidate paths below cover the field names observed in the wild
 * (see README "Discovering the endpoint" for how to verify). Add new
 * candidates as needed when the upstream payload changes; the rest of the
 * codebase does not need to know.
 */

type Json = unknown;

export interface ParseOptions {
  reference: string;
}

export function parseShipment(raw: Json, opts: ParseOptions): Shipment | null {
  const root = unwrapRoot(raw);
  if (!root) return null;

  const sender = parseAddress(pick(root, ADDRESS_PATHS.sender));
  const receiver = parseAddress(pick(root, ADDRESS_PATHS.receiver));
  const packageDetails = parsePackageDetails(root);
  const trackingHistory = parseEvents(pick(root, EVENT_PATHS.history));
  const packageEvents = parsePackageEvents(pick(root, EVENT_PATHS.perPackage));

  return {
    reference: opts.reference,
    shipmentId: pickString(root, [
      "id",
      "shipmentId",
      "shipment.id",
      "shipmentReferenceNumber",
    ]),
    sttNumber: pickString(root, [
      "stt",
      "sttNumber",
      "trackTraceNumber",
      "sttNo",
    ]),
    transportMode: pickString(root, [
      "transportMode",
      "mode",
      "shipment.transportMode",
      "product",
    ]),
    status: pickString(root, [
      "status",
      "currentStatus",
      "latestStatus.code",
      "progressBar.activeStep",
    ]),
    estimatedDelivery: pickString(root, [
      "estimatedDelivery",
      "eta",
      "estimatedDeliveryDate",
      "deliveryDate.estimated",
      "deliveryDate.agreed",
    ]),
    sender,
    receiver,
    packageDetails,
    trackingHistory,
    packageEvents,
  };
}

// --- root unwrapping -------------------------------------------------------

/**
 * The upstream payload sometimes nests the shipment under `data`, `result`,
 * `shipment`, or `shipments[0]`. Try a few common wrappers before giving up.
 */
function unwrapRoot(raw: Json): Record<string, unknown> | null {
  if (!isObject(raw)) return null;

  if (Array.isArray(raw["shipments"]) && raw["shipments"].length > 0) {
    const first = raw["shipments"][0];
    if (isObject(first)) return first;
  }
  for (const key of ["data", "result", "shipment", "payload"]) {
    const inner = raw[key];
    if (isObject(inner)) return inner;
  }
  return raw;
}

// --- field path candidates -------------------------------------------------

const ADDRESS_PATHS = {
  sender: [
    "sender",
    "shipper",
    "from",
    "consignor",
    "location.collectFrom",
    "location.shipperPlace",
    "location.shipper",
    "references.sender",
  ] as const,
  receiver: [
    "receiver",
    "consignee",
    "to",
    "recipient",
    "location.deliverTo",
    "location.consigneePlace",
    "location.consignee",
    "references.receiver",
  ] as const,
};

const EVENT_PATHS = {
  history: [
    "trackingHistory",
    "events",
    "history",
    "trackingEvents",
    "statusHistory",
    "trackAndTrace",
    "events.history",
  ] as const,
  perPackage: ["packageEvents", "perPackageEvents", "packages"] as const,
};

const PACKAGE_FIELD_PATHS = {
  pieceCount: [
    "pieceCount",
    "pieces",
    "numberOfPieces",
    "totalPieces",
    "quantity",
  ],
  totalWeightKg: [
    "totalWeightKg",
    "weightKg",
    "totalWeight",
    "weight",
    "grossWeight",
  ],
  totalVolumeM3: ["totalVolumeM3", "volumeM3", "volume", "grossVolume"],
  loadingMeters: ["loadingMeters", "ldm"],
  goodsDescription: ["goodsDescription", "description", "goods"],
} as const;

// --- field parsers ---------------------------------------------------------

function parseAddress(raw: unknown): Address {
  if (!isObject(raw)) {
    return {
      name: null,
      street: null,
      city: null,
      postalCode: null,
      country: null,
    };
  }
  return {
    name: pickString(raw, ["name", "companyName", "fullName"]),
    street: pickString(raw, ["street", "addressLine1", "address"]),
    city: pickString(raw, ["city", "town", "cityName"]),
    postalCode: pickString(raw, ["postalCode", "zip", "zipCode", "postCode"]),
    country: pickString(raw, ["country", "countryCode", "countryName"]),
  };
}

function parsePackageDetails(raw: Record<string, unknown>): PackageDetails {
  // Some payloads put package data inline at the root, others under "packageDetails"
  // or "totals". Merge a few candidate sources before extracting.
  const sources: Array<Record<string, unknown>> = [raw];
  for (const key of ["packageDetails", "totals", "summary", "goods", "cargo"]) {
    const v = raw[key];
    if (isObject(v)) sources.push(v);
  }

  const merged: Record<string, unknown> = {};
  for (const src of sources) {
    for (const [k, v] of Object.entries(src)) {
      if (merged[k] === undefined) merged[k] = v;
    }
  }

  return {
    pieceCount: pickNumber(merged, PACKAGE_FIELD_PATHS.pieceCount, {
      integer: true,
    }),
    totalWeightKg: pickNumber(merged, PACKAGE_FIELD_PATHS.totalWeightKg),
    totalVolumeM3: pickNumber(merged, PACKAGE_FIELD_PATHS.totalVolumeM3),
    loadingMeters: pickNumber(merged, PACKAGE_FIELD_PATHS.loadingMeters),
    goodsDescription: pickString(merged, PACKAGE_FIELD_PATHS.goodsDescription),
  };
}

function parseEvents(raw: unknown): TrackingEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!isObject(entry)) return [];
    const evt: TrackingEvent = {
      timestamp: pickString(entry, [
        "timestamp",
        "time",
        "date",
        "eventTime",
        "dateTime",
        "eventDate",
        "createdAt",
      ]),
      status: pickString(entry, [
        "status",
        "code",
        "statusCode",
        "eventCode",
        "event",
      ]),
      description: pickString(entry, [
        "description",
        "message",
        "text",
        "eventDescription",
        "comment",
      ]),
      location: pickString(entry, [
        "location",
        "place",
        "city",
        "site",
        "location.name",
        "terminal",
      ]),
      packageId: pickString(entry, ["packageId", "package", "pieceId"]),
    };
    return [evt];
  });
}

function parsePackageEvents(raw: unknown): Record<string, TrackingEvent[]> {
  const out: Record<string, TrackingEvent[]> = {};
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const id = pickString(entry, ["packageId", "id", "pieceId"]) ?? "unknown";
    const events = parseEvents(
      entry["events"] ?? entry["history"] ?? entry["trackingEvents"],
    );
    if (events.length > 0) out[id] = events;
  }
  return out;
}

// --- low-level helpers -----------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const v = readPath(obj, key);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function pickString(
  obj: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  const v = pick(obj, keys);
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function pickNumber(
  obj: Record<string, unknown>,
  keys: readonly string[],
  opts: { integer?: boolean } = {},
): number | null {
  const v = pick(obj, keys);
  if (typeof v === "number" && Number.isFinite(v)) {
    return opts.integer ? Math.trunc(v) : v;
  }
  if (isObject(v)) {
    const nested = pickNumber(v, ["value"], opts);
    if (nested !== null) return nested;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return opts.integer ? Math.trunc(n) : n;
  }
  return null;
}

/** Supports both flat keys and "dot.paths" for nested lookups. */
function readPath(obj: Record<string, unknown>, path: string): unknown {
  if (!path.includes(".")) return obj[path];
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}
