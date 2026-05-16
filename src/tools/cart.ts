import { createHash, randomBytes } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CookUnityAPI } from "../services/api.js";
import {
  AddToCartSchema,
  RemoveFromCartSchema,
  ClearCartSchema,
  PrepareOrderConfirmationSchema,
  ConfirmOrderSchema,
} from "../schemas/index.js";
import type {
  AddToCartInput,
  RemoveFromCartInput,
  ClearCartInput,
  PrepareOrderConfirmationInput,
  ConfirmOrderInput,
} from "../schemas/index.js";
import { handleError, toStructured } from "../services/helpers.js";

type CartToolOptions = {
  allowMutations: boolean;
  allowConfirmOrder: boolean;
};

type PendingOrderConfirmation = {
  expiresAt: number;
  fingerprint: string;
};

const CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const pendingOrderConfirmations = new Map<string, PendingOrderConfirmation>();

function fingerprintOrder(input: {
  date: string;
  comment?: string;
  tip?: number;
  products: Array<{ qty: number; inventoryId: string }>;
}): string {
  const canonical = {
    date: input.date,
    comment: input.comment ?? "",
    tip: input.tip ?? 0,
    products: [...input.products].sort((a, b) => a.inventoryId.localeCompare(b.inventoryId)),
  };

  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function getCartProducts(api: CookUnityAPI, date: string): Promise<Array<{ qty: number; inventoryId: string }>> {
  const days = await api.getUpcomingDays();
  const day = days.find((d) => d.date === date);
  if (!day) {
    throw new Error(`No delivery found for ${date}. Check available dates with cookunity_list_deliveries.`);
  }
  if (!day.cart || day.cart.length === 0) {
    throw new Error(`Cart is empty for ${date}. Add meals first with cookunity_add_to_cart.`);
  }

  return day.cart.map((item) => ({
    qty: item.qty,
    inventoryId: item.product.inventoryId,
  }));
}

async function getDeliveryWindow(api: CookUnityAPI): Promise<{ start: string; end: string }> {
  let start = "11:00";
  let end = "20:00";

  try {
    const userInfo = await api.getUserInfo();
    if (userInfo.deliveryDays?.length) {
      start = userInfo.deliveryDays[0].time_start ?? start;
      end = userInfo.deliveryDays[0].time_end ?? end;
    }
  } catch {
    // Fall back to defaults if user info fetch fails.
  }

  return { start, end };
}

export function registerCartTools(server: McpServer, api: CookUnityAPI, options: CartToolOptions): void {
  if (!options.allowMutations) {
    return;
  }

  server.registerTool(
    "cookunity_add_to_cart",
    {
      title: "Add Meal to CookUnity Cart",
      description: `Add a meal to the cart for a specific delivery date.

Args:
  - date (string, required): YYYY-MM-DD delivery date
  - inventory_id (string, required): Inventory ID from menu/search results
  - quantity (number): Portions to add, default 1 (max 10)
  - batch_id (number, optional): Batch ID from menu results

Returns: Confirmation with updated quantity

Examples:
  - Add one meal: { date: "2025-02-24", inventory_id: "ABC123" }
  - Add 2 portions: { date: "2025-02-24", inventory_id: "ABC123", quantity: 2 }

Error Handling:
  - Invalid inventory_id: API returns error
  - Past cutoff: API returns error — check cutoff with cookunity_list_deliveries first`,
      inputSchema: AddToCartSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: AddToCartInput) => {
      try {
        const { added, cart } = await api.addMeal(params.date, params.inventory_id, params.quantity, params.batch_id);
        const cartTotalItems = cart.reduce((sum, item) => sum + item.qty, 0);
        const output = {
          success: true,
          date: params.date,
          inventory_id: added.inventoryId,
          quantity: added.qty,
          cart_total_items: cartTotalItems,
          message: `Added ${params.quantity} portion(s) to cart for ${params.date}. Cart now has ${cartTotalItems} item(s).`,
        };
        return { content: [{ type: "text", text: output.message }], structuredContent: toStructured(output) };
      } catch (error) {
        return handleError(error);
      }
    }
  );

  server.registerTool(
    "cookunity_remove_from_cart",
    {
      title: "Remove Meal from CookUnity Cart",
      description: `Remove a meal from the cart for a specific delivery date.

Args:
  - date (string, required): YYYY-MM-DD delivery date
  - inventory_id (string, required): Inventory ID of meal to remove
  - quantity (number): Portions to remove, default 1

Returns: Confirmation with updated quantity

Error Handling:
  - Meal not in cart: API returns error`,
      inputSchema: RemoveFromCartSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: RemoveFromCartInput) => {
      try {
        const result = await api.removeMeal(params.date, params.inventory_id, params.quantity);
        const output = {
          success: true,
          date: params.date,
          inventory_id: result.inventoryId,
          remaining_quantity: result.qty,
          message: `Removed ${params.quantity} portion(s) from cart for ${params.date}.`,
        };
        return { content: [{ type: "text", text: output.message }], structuredContent: toStructured(output) };
      } catch (error) {
        return handleError(error);
      }
    }
  );

  server.registerTool(
    "cookunity_clear_cart",
    {
      title: "Clear CookUnity Cart",
      description: `Clear all items from the cart for a specific delivery date. This removes ALL meals.

Args:
  - date (string, required): YYYY-MM-DD delivery date

Returns: Confirmation message

Error Handling:
  - Past cutoff: API returns error`,
      inputSchema: ClearCartSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: ClearCartInput) => {
      try {
        await api.clearCart(params.date);
        const output = { success: true, date: params.date, message: `Cart cleared for ${params.date}.` };
        return { content: [{ type: "text", text: output.message }], structuredContent: toStructured(output) };
      } catch (error) {
        return handleError(error);
      }
    }
  );

  if (!options.allowConfirmOrder) {
    return;
  }

  server.registerTool(
    "cookunity_prepare_order_confirmation",
    {
      title: "Prepare CookUnity Order Confirmation",
      description: `Prepare a CookUnity order confirmation token for the current cart contents. This tool does NOT place the order.

Call this immediately before cookunity_confirm_order. The returned confirmation_token is short-lived and is bound to the delivery date, current cart contents, comment, and tip.

Args:
  - date (string, required): YYYY-MM-DD delivery date
  - comment (string, optional): Delivery instructions
  - tip (number, optional): Tip amount in dollars

Returns: A short-lived confirmation token and order summary.`,
      inputSchema: PrepareOrderConfirmationSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: PrepareOrderConfirmationInput) => {
      try {
        const products = await getCartProducts(api, params.date);
        const token = randomBytes(18).toString("base64url");
        const expiresAt = Date.now() + CONFIRMATION_TTL_MS;
        pendingOrderConfirmations.set(token, {
          expiresAt,
          fingerprint: fingerprintOrder({ ...params, products }),
        });

        const output = {
          success: true,
          delivery_date: params.date,
          confirmation_token: token,
          expires_at: new Date(expiresAt).toISOString(),
          unique_meals: products.length,
          total_portions: products.reduce((sum, product) => sum + product.qty, 0),
          message: `Prepared confirmation token for ${params.date}. To place the order, call cookunity_confirm_order with this confirmation_token before ${new Date(expiresAt).toISOString()}.`,
        };

        return { content: [{ type: "text", text: output.message }], structuredContent: toStructured(output) };
      } catch (error) {
        return handleError(error);
      }
    }
  );

  server.registerTool(
    "cookunity_confirm_order",
    {
      title: "Confirm CookUnity Order",
      description: `Confirm/place the order for a delivery date. Takes the current cart contents and submits them as an order.

This is a destructive account action and requires a confirmation_token from cookunity_prepare_order_confirmation.

Prerequisites:
  - Meals must be in the cart (use cookunity_add_to_cart first)
  - Must be before the cutoff (check with cookunity_list_deliveries)
  - Cart should have enough meals to meet the plan minimum (typically 6)
  - confirmation_token must be fresh and must match the current cart contents, delivery date, comment, and tip

Args:
  - date (string, required): YYYY-MM-DD delivery date
  - confirmation_token (string, required): Token returned by cookunity_prepare_order_confirmation
  - comment (string, optional): Delivery instructions; must match prepare step if provided there
  - tip (number, optional): Tip amount in dollars; must match prepare step if provided there

Returns: Order confirmation with ID and payment status, or error with out-of-stock meal IDs

Important: Without confirming, cart items are NOT locked in. CookUnity will auto-fill with recommendations at cutoff instead.`,
      inputSchema: ConfirmOrderSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: ConfirmOrderInput) => {
      try {
        const pending = pendingOrderConfirmations.get(params.confirmation_token);
        if (!pending) {
          return { content: [{ type: "text", text: "Invalid or already used confirmation_token. Call cookunity_prepare_order_confirmation again." }], isError: true };
        }
        if (Date.now() > pending.expiresAt) {
          pendingOrderConfirmations.delete(params.confirmation_token);
          return { content: [{ type: "text", text: "Expired confirmation_token. Call cookunity_prepare_order_confirmation again." }], isError: true };
        }

        const products = await getCartProducts(api, params.date);
        const fingerprint = fingerprintOrder({
          date: params.date,
          comment: params.comment,
          tip: params.tip,
          products,
        });

        if (fingerprint !== pending.fingerprint) {
          return {
            content: [{ type: "text", text: "Order details changed after preparation. Re-run cookunity_prepare_order_confirmation and confirm with the new token." }],
            isError: true,
          };
        }

        pendingOrderConfirmations.delete(params.confirmation_token);
        const { start, end } = await getDeliveryWindow(api);
        const result = await api.createOrder(params.date, start, end, products, {
          comment: params.comment,
          tip: params.tip,
        });

        if (result.__typename === "OrderCreationError") {
          const msg = result.error || "Unknown error";
          const oos = result.outOfStockIds?.length ? ` Out of stock: ${result.outOfStockIds.join(", ")}` : "";
          return { content: [{ type: "text", text: `Order failed: ${msg}${oos}` }], isError: true };
        }

        const mealsConfirmed = products.reduce((sum, product) => sum + product.qty, 0);
        const output = {
          success: true,
          order_id: result.id,
          delivery_date: result.deliveryDate,
          payment_status: result.paymentStatus,
          meals_confirmed: mealsConfirmed,
          message: `Order confirmed for ${params.date}. ${mealsConfirmed} meals locked in. Order ID: ${result.id}`,
        };
        return { content: [{ type: "text", text: output.message }], structuredContent: toStructured(output) };
      } catch (error) {
        return handleError(error);
      }
    }
  );
}
