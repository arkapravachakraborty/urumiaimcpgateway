import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  orderStatuses,
  productStatuses,
  WooCommerceApiError,
  type OrderStatus,
  type ProductStatus,
  type WooOrder,
  type WooProduct,
  type WooCommerceClient,
} from "./client.js";

const listProductsSchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  page: z.number().int().positive().default(1),
  per_page: z.number().int().min(1).max(100).default(10),
  status: z.enum(productStatuses).optional(),
});

const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  regular_price: z.string().regex(/^\d+(?:\.\d+)?$/, "Must be a non-negative decimal price."),
  description: z.string().max(10_000).optional(),
  status: z.enum(productStatuses).default("publish"),
});

const dateSchema = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

const listOrdersSchema = z
  .object({
    status: z.enum(orderStatuses).optional(),
    after: dateSchema.optional(),
    before: dateSchema.optional(),
    today: z.boolean().default(false),
    page: z.number().int().positive().default(1),
  })
  .refine(
    ({ today, after, before }) => !today || (after === undefined && before === undefined),
    { message: "Use today or after/before, not both." },
  )
  .refine(
    ({ after, before }) =>
      after === undefined || before === undefined || Date.parse(after) <= Date.parse(before),
    { message: "after must be earlier than or equal to before." },
  );

const getOrderSchema = z.object({ id: z.number().int().positive() });
const updateOrderStatusSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(orderStatuses),
});

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function toolError(error: unknown) {
  if (!(error instanceof WooCommerceApiError)) throw error;
  return {
    isError: true,
    content: [{ type: "text" as const, text: `${error.code}: ${error.message}` }],
  };
}

function productSummary(product: WooProduct) {
  return {
    id: product.id,
    name: product.name,
    status: product.status,
    price: product.price ?? product.regular_price ?? "",
    sku: product.sku ?? "",
    ...(product.permalink ? { permalink: product.permalink } : {}),
  };
}

function orderSummary(order: WooOrder) {
  return {
    id: order.id,
    status: order.status,
    date: order.date_created ?? null,
    total: order.total,
    currency: order.currency,
    items: (order.line_items ?? []).slice(0, 10).map(({ name, quantity, price }) => ({
      name,
      quantity,
      ...(price !== undefined ? { price } : {}),
    })),
  };
}

export function createWooServer(client: WooCommerceClient): McpServer {
  const server = new McpServer({ name: "woo-mcp", version: "1.0.0" });

  server.registerTool(
    "list_products",
    {
      description: "Search and page through WooCommerce products.",
      inputSchema: listProductsSchema.shape,
    },
    async (input) => {
      try {
        const { search, page, per_page, status } = listProductsSchema.parse(input);
        const result = await client.listProducts({ search, page, per_page, status });
        return textResult({
          page,
          totalPages: result.totalPages,
          total: result.total,
          products: result.items.map(productSummary),
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_product",
    {
      description: "Create a WooCommerce product, published by default.",
      inputSchema: createProductSchema.shape,
    },
    async (input) => {
      try {
        const product = await client.createProduct(createProductSchema.parse(input));
        return textResult(productSummary(product));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_orders",
    {
      description:
        "List WooCommerce orders by status and date. Set today=true to include orders created today in UTC.",
      inputSchema: listOrdersSchema.shape,
    },
    async (input) => {
      try {
        const parsed = listOrdersSchema.parse(input);
        const dates = parsed.today ? utcTodayRange() : { after: parsed.after, before: parsed.before };
        const result = await client.listOrders({
          status: parsed.status,
          page: parsed.page,
          after: dates.after,
          before: dates.before,
        });
        return textResult({
          page: parsed.page,
          totalPages: result.totalPages,
          total: result.total,
          orders: result.items.map(orderSummary),
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_order",
    {
      description: "Get a WooCommerce order by its numeric ID.",
      inputSchema: getOrderSchema.shape,
    },
    async ({ id }) => {
      try {
        return textResult(orderSummary(await client.getOrder(id)));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "update_order_status",
    {
      description: "Change an order to a standard WooCommerce order status.",
      inputSchema: updateOrderStatusSchema.shape,
    },
    async ({ id, status }) => {
      try {
        return textResult(orderSummary(await client.updateOrderStatus(id, status)));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

function utcTodayRange(): { after: string; before: string } {
  const now = new Date();
  return {
    after: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString(),
    before: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - 1,
    ).toISOString(),
  };
}

export type { OrderStatus, ProductStatus };
