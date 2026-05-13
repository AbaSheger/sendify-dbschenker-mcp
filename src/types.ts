import { z } from "zod";

/**
 * Output schemas describe the shape returned by the `track_shipment` tool.
 *
 * These are deliberately narrower than the raw upstream payload: we project
 * only the fields the challenge asks for. That gives the LLM a small, stable
 * surface to reason about and lets us evolve the upstream parser without
 * breaking tool callers.
 */

export const AddressSchema = z.object({
  name: z.string().nullable(),
  street: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
});
export type Address = z.infer<typeof AddressSchema>;

export const PackageDetailsSchema = z.object({
  pieceCount: z.number().int().nonnegative().nullable(),
  totalWeightKg: z.number().nonnegative().nullable(),
  totalVolumeM3: z.number().nonnegative().nullable(),
  loadingMeters: z.number().nonnegative().nullable(),
  goodsDescription: z.string().nullable(),
});
export type PackageDetails = z.infer<typeof PackageDetailsSchema>;

export const TrackingEventSchema = z.object({
  timestamp: z.string().nullable(),
  status: z.string().nullable(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  packageId: z.string().nullable(),
});
export type TrackingEvent = z.infer<typeof TrackingEventSchema>;

export const ShipmentSchema = z.object({
  reference: z.string(),
  shipmentId: z.string().nullable(),
  sttNumber: z.string().nullable(),
  transportMode: z.string().nullable(),
  status: z.string().nullable(),
  estimatedDelivery: z.string().nullable(),
  sender: AddressSchema,
  receiver: AddressSchema,
  packageDetails: PackageDetailsSchema,
  trackingHistory: z.array(TrackingEventSchema),
  /**
   * Bonus: per-package event streams, keyed by package identifier.
   * Empty object when the upstream payload does not split events by package.
   */
  packageEvents: z.record(z.string(), z.array(TrackingEventSchema)),
});
export type Shipment = z.infer<typeof ShipmentSchema>;

export const TrackShipmentInputSchema = z.object({
  reference: z
    .string()
    .trim()
    .min(1, "reference is required")
    .max(64, "reference is unreasonably long"),
});
export type TrackShipmentInput = z.infer<typeof TrackShipmentInputSchema>;
