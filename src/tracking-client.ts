import { TrackingError } from "./errors.js";
import { HttpClient } from "./http.js";
import { parseShipment } from "./parser.js";
import { type Shipment } from "./types.js";

export interface TrackingClient {
  trackShipment(reference: string): Promise<Shipment>;
}

export interface DbSchenkerClientOptions {
  /**
   * Template URL with `{ref}` as the placeholder for the reference number.
   *
   * Example (placeholder, replace with the real endpoint discovered via
   * DevTools on https://www.dbschenker.com/app/tracking-public/):
   *
   *   https://www.dbschenker.com/api/tracking-public/shipments?refNumber={ref}
   */
  endpointTemplate: string;
  http?: HttpClient;
  extraHeaders?: Record<string, string>;
}

const DEFAULT_ENDPOINT_TEMPLATES = [
  "https://mydsv.dsv.com/nges-portal/api/public/tracking-public/shipments?referenceNumber={ref}",
  "https://mydsv.dsv.com/nges-portal/api/public/tracking/v1/shipments?referenceNumber={ref}",
];

const DEFAULT_HEADERS = {
  "Accept-Language": "en-US",
  "X-Version": "4",
};

/**
 * Calls the DB Schenker public tracking endpoint and projects the response
 * into the `Shipment` shape promised by the MCP tool.
 *
 * The endpoint URL is not hard-coded: it is provided by configuration so
 * that the project can adapt to upstream URL changes without a code edit,
 * and so that tests can inject a mocked client without spinning up a fake
 * Schenker server.
 */
export class DbSchenkerClient implements TrackingClient {
  private readonly endpointTemplates: string[];
  private readonly http: HttpClient;
  private readonly extraHeaders: Record<string, string>;

  constructor(opts: DbSchenkerClientOptions) {
    if (!opts.endpointTemplate.includes("{ref}")) {
      throw new TrackingError(
        "CONFIG_ERROR",
        "endpointTemplate must include the {ref} placeholder",
      );
    }
    this.endpointTemplates = [opts.endpointTemplate];
    this.http = opts.http ?? new HttpClient();
    this.extraHeaders = { ...DEFAULT_HEADERS, ...opts.extraHeaders };
  }

  static withDefaultEndpoints(
    opts: Omit<DbSchenkerClientOptions, "endpointTemplate">,
  ): TrackingClient {
    return new MultiEndpointTrackingClient(DEFAULT_ENDPOINT_TEMPLATES, opts);
  }

  async trackShipment(reference: string): Promise<Shipment> {
    const ref = reference.trim();
    if (!ref) {
      throw new TrackingError("INVALID_REFERENCE", "reference cannot be empty");
    }
    if (!/^[A-Za-z0-9\-_/]+$/.test(ref)) {
      throw new TrackingError(
        "INVALID_REFERENCE",
        "reference contains unexpected characters",
      );
    }

    const url = this.endpointTemplates[0]?.replace(
      "{ref}",
      encodeURIComponent(ref),
    );
    if (!url) {
      throw new TrackingError(
        "CONFIG_ERROR",
        "no endpoint templates configured",
      );
    }
    const response = await this.http.getJson(url, this.extraHeaders);

    let raw: unknown;
    try {
      raw = JSON.parse(response.body);
    } catch (err) {
      throw new TrackingError(
        "PARSE_ERROR",
        "upstream response was not valid JSON",
        { cause: err },
      );
    }

    const shipment = parseShipment(raw, { reference: ref });
    if (!shipment) {
      // Some upstreams return a 200 with an empty body for "not found"
      throw new TrackingError(
        "NOT_FOUND",
        "no shipment found for that reference",
      );
    }
    return shipment;
  }
}

class MultiEndpointTrackingClient implements TrackingClient {
  private readonly clients: DbSchenkerClient[];

  constructor(
    endpointTemplates: string[],
    opts: Omit<DbSchenkerClientOptions, "endpointTemplate">,
  ) {
    this.clients = endpointTemplates.map(
      (endpointTemplate) => new DbSchenkerClient({ ...opts, endpointTemplate }),
    );
  }

  async trackShipment(reference: string): Promise<Shipment> {
    let lastError: TrackingError | undefined;

    for (const client of this.clients) {
      try {
        return await client.trackShipment(reference);
      } catch (err) {
        const tErr =
          err instanceof TrackingError
            ? err
            : new TrackingError("UPSTREAM_ERROR", String(err), { cause: err });
        lastError = tErr;

        if (
          tErr.code === "INVALID_REFERENCE" ||
          tErr.code === "RATE_LIMITED" ||
          tErr.code === "TIMEOUT" ||
          tErr.code === "NETWORK_ERROR"
        ) {
          throw tErr;
        }
      }
    }

    throw (
      lastError ??
      new TrackingError("NOT_FOUND", "no shipment found for that reference")
    );
  }
}
