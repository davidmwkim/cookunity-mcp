# cookunity-mcp-server

[![npm version](https://img.shields.io/npm/v/cookunity-mcp-server.svg)](https://www.npmjs.com/package/cookunity-mcp-server)
[![npm downloads](https://img.shields.io/npm/dm/cookunity-mcp-server.svg)](https://www.npmjs.com/package/cookunity-mcp-server)

<a href="https://glama.ai/mcp/servers/@ggonzalezaleman/cook-unity-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@ggonzalezaleman/cook-unity-mcp/badge" />
</a>

> ⚠️ **Unofficial.** This project is not affiliated with, endorsed by, or associated with CookUnity in any way. It was built by reverse-engineering their internal APIs for personal use.

MCP server for [CookUnity](https://www.cookunity.com) meal delivery service. Browse menus, view deliveries, inspect carts, estimate pricing, and optionally manage carts/orders.

## Security defaults

This server uses authenticated CookUnity credentials and can expose account data to an MCP client. By default, the server is configured for safer personal use:

- `stdio` transport is the default.
- HTTP transport requires `MCP_AUTH_TOKEN` and binds to `127.0.0.1` unless `HOST` is explicitly set.
- Account-mutating tools are hidden unless `COOKUNITY_ENABLE_MUTATIONS=true`.
- Actual order placement remains hidden unless `COOKUNITY_ENABLE_CONFIRM_ORDER=true` is also set.
- Full email, street address, and raw payment display fields are redacted unless `COOKUNITY_SHOW_SENSITIVE_DATA=true`.
- Order placement is a two-step flow: prepare a short-lived confirmation token, then confirm with that token.

## Installation

```bash
npm install -g cookunity-mcp-server
```

Or run directly with npx:

```bash
npx cookunity-mcp-server
```

For account-sensitive use, prefer building from a pinned source checkout instead of executing an unpinned package repeatedly with `npx`.

## Tools

### Menu & Discovery

| Tool | Description |
|------|-------------|
| `cookunity_get_menu` | Browse meals with filters (category, diet, price, rating) and pagination |
| `cookunity_search_meals` | Search by keyword across name, description, cuisine, chef, ingredients, diet tags |
| `cookunity_get_meal_details` | Full nutritional info, allergens, and ingredients for a specific meal |

### Read-only Cart, Deliveries & Scheduling

| Tool | Description |
|------|-------------|
| `cookunity_get_cart` | View cart contents for a specific delivery date |
| `cookunity_next_delivery` | Get nearest delivery with meals (order, cart, or auto-picks) |
| `cookunity_list_deliveries` | All upcoming weeks with status, meals, cutoffs, skip state |

### Account & Pricing

| Tool | Description |
|------|-------------|
| `cookunity_get_user_info` | User profile, plan, delivery days, coarse addresses, and credits; sensitive fields redacted by default |
| `cookunity_list_orders` | Order history with pagination |
| `cookunity_order_history` | Past invoices and meal details; payment display fields redacted by default |
| `cookunity_get_price_breakdown` | Price estimate with taxes, fees, credits, and promo discounts |

### Optional mutation tools

These are only registered when `COOKUNITY_ENABLE_MUTATIONS=true`.

| Tool | Description |
|------|-------------|
| `cookunity_add_to_cart` | Add meal to cart by inventory_id and date |
| `cookunity_remove_from_cart` | Remove meal from cart by inventory_id |
| `cookunity_clear_cart` | Clear all cart items for a delivery date |
| `cookunity_skip_delivery` | Skip a delivery week |
| `cookunity_unskip_delivery` | Unskip a previously skipped week |

### Optional order-placement tools

These are only registered when both `COOKUNITY_ENABLE_MUTATIONS=true` and `COOKUNITY_ENABLE_CONFIRM_ORDER=true` are set.

| Tool | Description |
|------|-------------|
| `cookunity_prepare_order_confirmation` | Returns a short-lived one-time token bound to the current cart/date/comment/tip |
| `cookunity_confirm_order` | Places the order only when given a valid confirmation token |

## Typical read-only workflow

```
1. cookunity_list_deliveries    → Find next editable delivery date + cutoff
2. cookunity_get_menu           → Browse available meals for that date
3. cookunity_search_meals       → Search for specific cuisines/proteins
4. cookunity_get_meal_details   → Check nutrition/allergens
5. cookunity_get_price_breakdown→ Estimate price for cart or selected meals
```

## Optional order workflow

Only use this after intentionally enabling mutation and order-placement tools.

```
1. COOKUNITY_ENABLE_MUTATIONS=true
2. COOKUNITY_ENABLE_CONFIRM_ORDER=true
3. cookunity_list_deliveries              → Find valid delivery date + cutoff
4. cookunity_add_to_cart                  → Add meals until plan is full
5. cookunity_get_price_breakdown          → Verify total before confirming
6. cookunity_prepare_order_confirmation   → Generate short-lived confirmation token
7. cookunity_confirm_order                → Lock in the order using that token
```

> **Important:** Without confirming, cart items are NOT locked in. CookUnity auto-fills with its own recommendations at the cutoff deadline.

## Setup

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `COOKUNITY_EMAIL` | Yes | CookUnity account email |
| `COOKUNITY_PASSWORD` | Yes | CookUnity account password |
| `TRANSPORT` | No | `stdio` (default) or `http` |
| `HOST` | No | HTTP bind host when using `http` transport; defaults to `127.0.0.1` |
| `PORT` | No | HTTP port when using `http` transport; defaults to `3000` |
| `MCP_AUTH_TOKEN` | Required for HTTP | Bearer token required for HTTP `/mcp` requests |
| `COOKUNITY_ENABLE_MUTATIONS` | No | Set to `true` to expose cart and delivery mutation tools |
| `COOKUNITY_ENABLE_CONFIRM_ORDER` | No | Set to `true` to expose order placement tools; requires mutation tools enabled |
| `COOKUNITY_SHOW_SENSITIVE_DATA` | No | Set to `true` to include full email, street address, and raw payment display values |

## Configuration

### Claude Desktop / Cursor / OpenClaw (stdio, read-only default)

```json
{
  "mcpServers": {
    "cookunity": {
      "command": "npx",
      "args": ["cookunity-mcp-server"],
      "env": {
        "COOKUNITY_EMAIL": "your@email.com",
        "COOKUNITY_PASSWORD": "your-password",
        "TRANSPORT": "stdio"
      }
    }
  }
}
```

### Stdio with mutation tools enabled

```json
{
  "mcpServers": {
    "cookunity": {
      "command": "npx",
      "args": ["cookunity-mcp-server"],
      "env": {
        "COOKUNITY_EMAIL": "your@email.com",
        "COOKUNITY_PASSWORD": "your-password",
        "TRANSPORT": "stdio",
        "COOKUNITY_ENABLE_MUTATIONS": "true"
      }
    }
  }
}
```

### Stdio with order placement enabled

```json
{
  "mcpServers": {
    "cookunity": {
      "command": "npx",
      "args": ["cookunity-mcp-server"],
      "env": {
        "COOKUNITY_EMAIL": "your@email.com",
        "COOKUNITY_PASSWORD": "your-password",
        "TRANSPORT": "stdio",
        "COOKUNITY_ENABLE_MUTATIONS": "true",
        "COOKUNITY_ENABLE_CONFIRM_ORDER": "true"
      }
    }
  }
}
```

### Streamable HTTP

HTTP mode requires bearer-token authentication.

```bash
COOKUNITY_EMAIL=your@email.com \
COOKUNITY_PASSWORD=your-password \
TRANSPORT=http \
HOST=127.0.0.1 \
PORT=3000 \
MCP_AUTH_TOKEN='replace-with-a-long-random-token' \
npx cookunity-mcp-server
```

Clients must call `/mcp` with:

```http
Authorization: Bearer replace-with-a-long-random-token
```

### From Source (development)

```bash
git clone https://github.com/ggonzalezaleman/cookunity-mcp.git
cd cookunity-mcp
npm ci
npm run build
node dist/index.js
```

## API Details

This server reverse-engineers CookUnity's internal GraphQL APIs:

- **Menu Service** (`https://menu-service.cookunity.com/graphql`) — meal browsing and search
- **Subscription Service** (`https://subscription-back.cookunity.com/graphql`) — cart, orders, deliveries, user info

Authentication uses Auth0 with the `cookunity` realm. Tokens are cached and refreshed automatically.

### Known Limitations

- GraphQL introspection is disabled — schemas were reverse-engineered from frontend JS bundles and error probing
- `createOrder` requires the exact number of meals matching the user's plan (e.g., 6 for a 6-meal plan)
- Delivery window defaults to 11:00–20:00 when the user profile delivery window cannot be fetched
- Confirmation tokens are in-memory and are lost when the MCP server process restarts

## License

MIT
