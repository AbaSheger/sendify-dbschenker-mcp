# DB Schenker Shipment Tracker MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes a
single tool, `track_shipment`, for looking up DB Schenker shipments by reference
number on the public tracking endpoint.

Built as a submission for the
[Sendify code challenge](https://careers.sendify.se).

## What it does

Given a DB Schenker reference number, the `track_shipment` tool returns a
structured `Shipment` object containing:

- `sender` / `receiver` — name, street, city, postal code, country
- `packageDetails` — piece count, total weight, volume, loading meters, goods
  description
- `trackingHistory` — every event for the shipment (timestamp, status,
  description, location)
- `packageEvents` — per-package event streams when the upstream payload
  separates them (the challenge bonus)
- shipment metadata — `shipmentId`, `sttNumber`, `transportMode`, `status`,
  `estimatedDelivery`

The output schema lives in [`src/types.ts`](src/types.ts).

## Quick start

### Prerequisites

- Node.js 18 or later
- npm (bundled with Node)

### Install and build

```bash
git clone https://github.com/AbaSheger/sendify-dbschenker-mcp.git
cd sendify-dbschenker-mcp
npm install
npm run build
```

### Configure the tracking endpoint

The public tracking page at https://www.dbschenker.com/app/tracking-public/
is a single-page app that fetches shipment data from a JSON endpoint. That
endpoint URL is the one piece of configuration this server needs.

Copy the example env file and fill in the URL (see
[Discovering the endpoint](#discovering-the-endpoint) below):

```bash
cp .env.example .env
# edit .env and set SCHENKER_TRACKING_URL
```

The URL must contain `{ref}` as the placeholder for the reference number,
for example:

```
SCHENKER_TRACKING_URL=https://www.dbschenker.com/api/tracking-public/shipments?refNumber={ref}
```

### Run

```bash
npm start
```

The server speaks MCP over stdio (standard input / standard output), which is
how MCP clients like Claude Desktop start local servers.

### Test

```bash
npm test
```

Tests use mocked HTTP responses, so they run offline.

## Use with Claude Desktop

Add this entry to your `claude_desktop_config.json`
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "db-schenker": {
      "command": "node",
      "args": ["/absolute/path/to/sendify-dbschenker-mcp/dist/server.js"],
      "env": {
        "SCHENKER_TRACKING_URL": "https://www.dbschenker.com/api/tracking-public/shipments?refNumber={ref}"
      }
    }
  }
}
```

Restart Claude Desktop. The tool will appear as `track_shipment` and can be
called with a reference number from the example list:

```
1806203236  1806290829  1806273700  1806272330  1806271886
1806270433  1806268072  1806267579  1806264568  1806258974  1806256390
```

For development without a full build, swap `node` for `tsx` and point at
`src/server.ts`:

```json
{
  "command": "npx",
  "args": ["tsx", "/absolute/path/to/sendify-dbschenker-mcp/src/server.ts"]
}
```

## Discovering the endpoint

The challenge calls out the public tracking website as the data source. That
page is a SPA, so the actual JSON endpoint is one network call away:

1. Open https://www.dbschenker.com/app/tracking-public/ in Chrome
2. Open DevTools (`Cmd+Opt+I` / `F12`) and switch to the **Network** tab
3. Filter by **Fetch/XHR**
4. Enter a reference number (for example `1806203236`) and submit
5. Find the request that returns the shipment JSON (the response will contain
   sender/receiver/events)
6. Right-click the request, **Copy → Copy as cURL**, and read the URL and any
   required headers from there

Plug the URL into `.env` with `{ref}` in place of the actual reference
number. If the request needs custom headers (for example `Accept-Language`
or a CSRF token), add them as defaults in `src/server.ts` where
`DbSchenkerClient` is constructed.

The parser in [`src/parser.ts`](src/parser.ts) deliberately tolerates several
common field-name variations (`sender` vs `consignor`, `events` vs
`trackingHistory`, and so on), so it should handle minor shape changes
without code edits. If you see a field name that is not yet covered, add it
to the candidate list in that file.

## Design notes

A few decisions worth flagging, both because they shape the code and
because the challenge brief mentions interview discussion of trade-offs:

- **Stdio transport, not HTTP.** The MCP spec supports both. Stdio is the
  right choice for a tool that runs as a child process of a desktop client.
  No port management, no auth, no CORS.
- **One tool, narrow contract.** `track_shipment` takes a single string and
  returns a single typed object. A larger tool surface (search, subscribe,
  list) would be tempting but is outside the brief and would dilute the
  schema the LLM has to reason about.
- **Defensive parser, strict output.** The upstream payload shape is
  undocumented and may shift over time. The parser
  ([`src/parser.ts`](src/parser.ts)) reads through a small candidate list
  for each field and falls back to `null`. The output is then validated
  against a strict Zod schema, so callers get a stable contract even when
  the upstream wobbles.
- **Typed error codes.** [`src/errors.ts`](src/errors.ts) defines a small
  set of codes (`NOT_FOUND`, `RATE_LIMITED`, `UPSTREAM_ERROR`, `TIMEOUT`,
  `PARSE_ERROR`, `INVALID_REFERENCE`, `CONFIG_ERROR`, `NETWORK_ERROR`).
  The server returns these in the tool's error payload so an LLM (or any
  caller) can branch on them deterministically. Compare with returning a
  bare string: harder to act on, harder to test.
- **Retry with backoff for transient failures only.** The HTTP client
  retries on 429, 5xx, timeouts, and network errors with exponential
  backoff plus jitter. It does not retry on 4xx, because those are
  user-input problems that retry will not fix.
- **Endpoint URL is configuration, not code.** The DB Schenker SPA could
  move tomorrow. Keeping the URL in `.env` means a swap is a single line
  edit, not a release.
- **Dependency injection in the tracking client.** `DbSchenkerClient`
  takes its `HttpClient` as a constructor argument, and `HttpClient` takes
  its `fetch` as a constructor argument. That is why the tests can run
  without ever opening a real socket. Same shape, real or fake.

## Project structure

```
src/
├── server.ts            # MCP server, tool registration, env wiring
├── tracking-client.ts   # DbSchenkerClient (calls the public endpoint)
├── parser.ts            # Defensive raw-payload to Shipment mapper
├── http.ts              # fetch wrapper with timeout, retry, typed errors
├── errors.ts            # TrackingError and TrackingErrorCode
└── types.ts             # Zod schemas + inferred TypeScript types

tests/
├── parser.test.ts
├── tracking-client.test.ts
├── server.test.ts
└── fixtures.ts
```

## Environment variables

| Variable                | Required | Default | Purpose                                                     |
|-------------------------|----------|---------|-------------------------------------------------------------|
| `SCHENKER_TRACKING_URL` | yes      | -       | Endpoint template, must contain `{ref}`                     |
| `SCHENKER_TIMEOUT_MS`   | no       | `10000` | Per-request timeout in milliseconds                         |
| `SCHENKER_MAX_RETRIES`  | no       | `2`     | Retry attempts for transient failures (429, 5xx, timeouts)  |
| `DEBUG`                 | no       | `0`     | Set to `1` for verbose logging to stderr                    |

## Error responses

When the tool fails, it returns an error result with a JSON body of this
shape:

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

## What I would do with more time

- **Replace the env-driven endpoint with a discovery step at startup.** Hit
  the public tracking page once, parse the bundle, extract the API base
  URL. That removes the manual DevTools step and makes the server
  self-configuring.
- **Add a `subscribe_shipment` tool** that streams new events as
  notifications, using MCP's `LoggingMessageNotification` channel.
- **Cache successful lookups for a short window.** The example references
  return the same data minute-to-minute, and a 30 second TTL would
  noticeably reduce upstream load.
- **Generate the parser candidate list from a real-payload fixture.**
  Capture a few real responses, snapshot them, and let CI flag drift.
- **Wire up `playwright`-based fallback** for the case where the upstream
  blocks programmatic requests. Slower, but more resilient.

## License

MIT. See [LICENSE](LICENSE).
