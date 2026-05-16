#!/usr/bin/env node
/**
 * CookUnity MCP Server
 *
 * Provides tools to interact with CookUnity meal delivery service:
 * browse menus, manage carts, skip/unskip deliveries, and view order history.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CookUnityAPI } from "./services/api.js";
import { registerMenuTools } from "./tools/menu.js";
import { registerUserTools } from "./tools/user.js";
import { registerDeliveryTools } from "./tools/deliveries.js";
import { registerCartTools } from "./tools/cart.js";
import { registerPricingTools } from "./tools/pricing.js";

function envFlag(name: string): boolean {
  return process.env[name]?.toLowerCase() === "true";
}

function createServer(): McpServer {
  const email = process.env.COOKUNITY_EMAIL;
  const password = process.env.COOKUNITY_PASSWORD;

  if (!email || !password) {
    console.error("ERROR: COOKUNITY_EMAIL and COOKUNITY_PASSWORD environment variables are required.");
    process.exit(1);
  }

  const server = new McpServer({
    name: "cookunity-mcp-server",
    version: "1.0.0",
  });

  const api = new CookUnityAPI(email, password);
  const allowMutations = envFlag("COOKUNITY_ENABLE_MUTATIONS");
  const allowConfirmOrder = envFlag("COOKUNITY_ENABLE_CONFIRM_ORDER");

  registerMenuTools(server, api);
  registerUserTools(server, api);
  registerDeliveryTools(server, api, { allowMutations });
  registerCartTools(server, api, { allowMutations, allowConfirmOrder });
  registerPricingTools(server, api);

  if (!allowMutations) {
    console.error("CookUnity mutation tools are disabled. Set COOKUNITY_ENABLE_MUTATIONS=true to expose cart and delivery mutation tools.");
  } else if (!allowConfirmOrder) {
    console.error("CookUnity order placement is disabled. Set COOKUNITY_ENABLE_CONFIRM_ORDER=true to expose order confirmation tools.");
  }

  return server;
}

async function runStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("CookUnity MCP server running via stdio");
}

async function runHTTP(): Promise<void> {
  const { default: express } = await import("express");
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const token = process.env.MCP_AUTH_TOKEN;
  if (!token) {
    throw new Error("MCP_AUTH_TOKEN is required when TRANSPORT=http. Use stdio for local-only usage, or set a strong bearer token for HTTP.");
  }

  const server = createServer();
  const app = express();
  app.use(express.json({ limit: "64kb" }));

  app.use((req, res, next) => {
    if (req.get("Authorization") !== `Bearer ${token}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.HOST ?? "127.0.0.1";
  app.listen(port, host, () => {
    console.error(`CookUnity MCP server running on http://${host}:${port}/mcp`);
  });
}

// Signal handlers
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

const transport = process.env.TRANSPORT ?? "stdio";
if (transport === "http") {
  runHTTP().catch((err) => {
    console.error("Server error:", err);
    process.exit(1);
  });
} else if (transport === "stdio") {
  runStdio().catch((err) => {
    console.error("Server error:", err);
    process.exit(1);
  });
} else {
  console.error(`ERROR: Unsupported TRANSPORT value: ${transport}. Expected 'stdio' or 'http'.`);
  process.exit(1);
}
