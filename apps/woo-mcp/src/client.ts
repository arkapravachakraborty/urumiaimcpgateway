import { z } from "zod";
import type { WooConfig } from "./config.js";

export const productStatuses = ["publish", "future", "draft", "pending", "private"] as const;
export const orderStatuses = [
  "pending",
  "processing",
  "on-hold",
  "completed",
  "cancelled",
  "refunded",
  "failed",
  "checkout-draft",
] as const;

export type ProductStatus = (typeof productStatuses)[number];
export type OrderStatus = (typeof orderStatuses)[number];

const productSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  status: z.string(),
  price: z.string().nullable().optional(),
  regular_price: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  permalink: z.string().nullable().optional(),
});

const orderSchema = z.object({
  id: z.number().int(),
  status: z.string(),
  total: z.string(),
  currency: z.string(),
  date_created: z.string().nullable().optional(),
  line_items: z
    .array(
      z.object({
        name: z.string(),
        quantity: z.number().int(),
        price: z.string().optional(),
      }),
    )
    .optional(),
});

export type WooProduct = z.infer<typeof productSchema>;
export type WooOrder = z.infer<typeof orderSchema>;

export interface WooPage<T> {
  items: T[];
  total: number;
  totalPages: number;
}

export interface ProductListOptions {
  search?: string;
  page: number;
  per_page: number;
  status?: ProductStatus;
}

export interface OrderListOptions {
  status?: OrderStatus;
  after?: string;
  before?: string;
  page: number;
}

export class WooCommerceApiError extends Error {
  constructor(
    message: string,
    readonly code: "timeout" | "connection" | "http_error" | "invalid_response",
    readonly status?: number,
  ) {
    super(message);
    this.name = "WooCommerceApiError";
  }
}

export interface WooCommerceClientOptions {
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class WooCommerceClient {
  private readonly baseUrl: string;
  private readonly authorization: string;
  private readonly timeoutMs: number;
  private readonly fetchRequest: typeof fetch;

  constructor(config: WooConfig, options: WooCommerceClientOptions = {}) {
    this.baseUrl = `${config.WC_BASE_URL}/wp-json/wc/v3`;
    this.authorization = `Basic ${Buffer.from(
      `${config.WC_CONSUMER_KEY}:${config.WC_CONSUMER_SECRET}`,
    ).toString("base64")}`;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchRequest = options.fetch ?? fetch;
    this.publicHost = config.WC_PUBLIC_HOST;
  }

  private readonly publicHost: string | undefined;

  async listProducts(options: ProductListOptions): Promise<WooPage<WooProduct>> {
    const query = new URLSearchParams({
      page: String(options.page),
      per_page: String(options.per_page),
    });
    if (options.search !== undefined) query.set("search", options.search);
    if (options.status !== undefined) query.set("status", options.status);

    return this.requestPage("products", query, productSchema);
  }

  async createProduct(input: {
    name: string;
    regular_price: string;
    description?: string;
    status: ProductStatus;
  }): Promise<WooProduct> {
    return this.request("products", {
      method: "POST",
      body: JSON.stringify(input),
    }, productSchema);
  }

  async listOrders(options: OrderListOptions): Promise<WooPage<WooOrder>> {
    const query = new URLSearchParams({
      page: String(options.page),
      per_page: "10",
    });
    if (options.status !== undefined) query.set("status", options.status);
    if (options.after !== undefined) query.set("after", options.after);
    if (options.before !== undefined) query.set("before", options.before);

    return this.requestPage("orders", query, orderSchema);
  }

  async getOrder(id: number): Promise<WooOrder> {
    return this.request(`orders/${id}`, { method: "GET" }, orderSchema);
  }

  async updateOrderStatus(id: number, status: OrderStatus): Promise<WooOrder> {
    return this.request(
      `orders/${id}`,
      { method: "PUT", body: JSON.stringify({ status }) },
      orderSchema,
    );
  }

  private async requestPage<T>(
    resource: string,
    query: URLSearchParams,
    schema: z.ZodType<T>,
  ): Promise<WooPage<T>> {
    const { body, headers } = await this.requestRaw(`${resource}?${query}`, { method: "GET" });
    const parsed = z.array(schema).safeParse(body);
    if (!parsed.success) {
      throw new WooCommerceApiError("WooCommerce returned an unexpected response shape.", "invalid_response");
    }
    return {
      items: parsed.data,
      total: parseHeaderCount(headers.get("X-WP-Total")),
      totalPages: parseHeaderCount(headers.get("X-WP-TotalPages")),
    };
  }

  private async request<T>(
    path: string,
    init: Pick<RequestInit, "method" | "body">,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const { body } = await this.requestRaw(path, init);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new WooCommerceApiError("WooCommerce returned an unexpected response shape.", "invalid_response");
    }
    return parsed.data;
  }

  private async requestRaw(
    path: string,
    init: Pick<RequestInit, "method" | "body">,
  ): Promise<{ body: unknown; headers: Headers }> {
    const headers = new Headers({
      Accept: "application/json",
      Authorization: this.authorization,
    });
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    if (this.publicHost !== undefined) headers.set("Host", this.publicHost);

    let response: Response;
    let bodyText: string;
    try {
      response = await this.fetchRequest(`${this.baseUrl}/${path}`, {
        method: init.method,
        headers,
        body: init.body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      bodyText = await response.text();
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new WooCommerceApiError(
          `WooCommerce request timed out after ${this.timeoutMs} ms.`,
          "timeout",
        );
      }
      throw new WooCommerceApiError("Unable to connect to WooCommerce.", "connection");
    }

    if (!response.ok) {
      const message =
        response.status === 401 || response.status === 403
          ? "WooCommerce rejected the API credentials or their permissions."
          : response.status === 404
            ? "The requested WooCommerce resource was not found."
            : response.status === 429
              ? "WooCommerce rate-limited the request."
              : response.status >= 500
                ? "WooCommerce encountered a server error."
                : "WooCommerce rejected the request.";
      throw new WooCommerceApiError(
        message,
        "http_error",
        response.status,
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      throw new WooCommerceApiError("WooCommerce returned an invalid JSON response.", "invalid_response");
    }

    return { body, headers: response.headers };
  }
}

function parseHeaderCount(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return 0;
  return Number(value);
}
