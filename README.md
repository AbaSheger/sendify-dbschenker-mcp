# DB Schenker Shipment Tracker MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
one tool, `track_shipment`, for looking up DB Schenker/DSV shipments by public
tracking reference number.

Built as a submission for the Sendify code challenge.

## What It Does

Given a DB Schenker reference number, the `track_shipment` tool returns a
structured `Shipment` object containing:

- `sender` / `receiver` - name, street, city, postal code, country
- `packageDetails` - piece count, total weight, volume, loading meters, goods
  description
- `trackingHistory` - every event for the shipment
- `packageEvents` - per-package event streams when the upstream payload
  separates them
- shipment metadata - `shipmentId`, `sttNumber`, `transportMode`, `status`,
  `estimatedDelivery`

The output schema lives in [`src/types.ts`](src/types.ts).

## Quick Start

### Prerequisites

- Node.js 18 or later
- npm, bundled with Node

### Install And Build

```bash
git clone https://github.com/AbaSheger/sendify-dbschenker-mcp.git
cd sendify-dbschenker-mcp
npm install
npm run build
```

### Configure The Tracking Endpoint

No endpoint configuration is required for the challenge references. The server
ships with default public endpoint candidates derived from the current
DB Schenker/DSV public tracking app:

https://www.dbschenker.com/app/tracking-public/

That URL currently redirects to:

https://mydsv.dsv.com/app/tracking-public/

If the public site changes, override the endpoint with `SCHENKER_TRACKING_URL`.
The URL must contain `{ref}` as the placeholder for the reference number:

```bash
cp .env.example .env
```

```text
SCHENKER_TRACKING_URL=https://mydsv.dsv.com/nges-portal/api/public/tracking-public/shipments?referenceNumber={ref}
```

### Run

```bash
npm start
```

The server speaks MCP over stdio, which is how MCP clients like Claude Desktop
start local servers.

### Test

```bash
npm test
```

Tests use mocked HTTP responses, so they run offline.

## Use With Claude Desktop

Add this entry to `claude_desktop_config.json`
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "db-schenker": {
      "command": "node",
      "args": ["/absolute/path/to/sendify-dbschenker-mcp/dist/server.js"],
      "env": {}
    }
  }
}
```

Restart Claude Desktop. The tool will appear as `track_shipment` and can be
called with a reference number from the example list:

```text
1806203236  1806290829  1806273700  1806272330  1806271886
1806270433  1806268072  1806267579  1806264568  1806258974  1806256390
```

For development without a full build, swap `node` for `npx` + `tsx`:

```json
{
  "command": "npx",
  "args": ["tsx", "/absolute/path/to/sendify-dbschenker-mcp/src/server.ts"]
}
```

## Discovering The Endpoint

The challenge calls out the public tracking website as the data source. That
page is a SPA, so the actual JSON endpoint is discovered from the browser
network traffic:

1. Open https://www.dbschenker.com/app/tracking-public/ in Chrome.
2. Open DevTools (`Cmd+Opt+I` / `F12`) and switch to the Network tab.
3. Filter by Fetch/XHR.
4. Enter a reference number, for example `1806203236`, and submit.
5. Find the request that returns shipment JSON.
6. Right-click the request, choose Copy -> Copy as cURL, and read the URL and
   any required headers from there.

The current implementation already includes the public endpoint candidates
found this way. The env override is kept so the repo can adapt quickly if the
upstream app moves again.

## Design Notes

- **Stdio transport, not HTTP.** The MCP spec supports both. Stdio is the right
  choice for a tool that runs as a child process of a desktop client.
- **One tool, narrow contract.** `track_shipment` takes a single string and
  returns a typed object. A larger tool surface is outside the brief.
- **Defensive parser, strict output.** The upstream payload shape is
  undocumented. The parser reads through candidate field names and falls back
  to `null`, while the MCP tool exposes a stable Zod schema.
- **Typed error codes.** [`src/errors.ts`](src/errors.ts) defines stable codes
  such as `NOT_FOUND`, `RATE_LIMITED`, `TIMEOUT`, and `PARSE_ERROR`.
- **Retry with backoff.** The HTTP client retries transient failures only:
  429, 5xx, timeouts, and network errors.
- **Default public endpoints, with env override.** The server works without
  reviewer-side DevTools setup, but `SCHENKER_TRACKING_URL` remains available
  as a one-line override.
- **Dependency injection.** `DbSchenkerClient` takes its `HttpClient`, and
  `HttpClient` takes its `fetch`, so tests run without real network calls.

## Project Structure

```text
src/
|-- server.ts            # MCP server, tool registration, env wiring
|-- tracking-client.ts   # DbSchenkerClient and endpoint fallback client
|-- parser.ts            # Defensive raw-payload to Shipment mapper
|-- http.ts              # fetch wrapper with timeout, retry, typed errors
|-- errors.ts            # TrackingError and TrackingErrorCode
`-- types.ts             # Zod schemas and inferred TypeScript types

tests/
|-- parser.test.ts
|-- tracking-client.test.ts
|-- server.test.ts
`-- fixtures.ts
```

## Environment Variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SCHENKER_TRACKING_URL` | no | built in | Endpoint template override, must contain `{ref}` |
| `SCHENKER_TIMEOUT_MS` | no | `10000` | Per-request timeout in milliseconds |
| `SCHENKER_MAX_RETRIES` | no | `2` | Retry attempts for transient failures |
| `DEBUG` | no | `0` | Set to `1` for verbose logging to stderr |

## Error Responses

When the tool fails, it returns an error result with a JSON body:

```json
{
  "ok": false,
  "error": "RATE_LIMITED",
  "message": "upstream rate-limited the request",
  "reference": "1806203236",
  "upstreamStatus": 429
}
```

`error` is one of the codes listed in [`src/errors.ts`](src/errors.ts).

## What I Would Do With More Time

- Add endpoint discovery at startup by parsing the tracking app bundle and
  refreshing the public endpoint candidates automatically.
- Add a `subscribe_shipment` tool that streams new events as MCP notifications.
- Cache successful lookups for a short window to reduce upstream load.
- Capture a few real upstream payloads, redact them, and use them as parser
  regression fixtures.
- Add a Playwright-based fallback for cases where the upstream blocks direct
  programmatic requests.

## License

MIT. See [LICENSE](LICENSE).
