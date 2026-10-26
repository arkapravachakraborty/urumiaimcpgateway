import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const emptyInputSchema = z.object({});
const facts = [
  "The Model Context Protocol uses JSON-RPC 2.0 messages.",
  "Streamable HTTP is an MCP transport for communicating over HTTP.",
  "TypeScript is a strongly typed programming language that builds on JavaScript.",
  "Kubernetes manages containerized workloads and services.",
];

class MathExpressionParser {
  private position = 0;
  private depth = 0;

  constructor(private readonly expression: string) {}

  parse(): number {
    const value = this.parseAdditive();
    this.skipWhitespace();
    if (this.position !== this.expression.length) {
      throw new Error("Unexpected character in expression.");
    }
    if (!Number.isFinite(value)) {
      throw new Error("Expression result is not a finite number.");
    }
    return value;
  }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();
    while (true) {
      if (this.consume("+")) {
        value += this.parseMultiplicative();
      } else if (this.consume("-")) {
        value -= this.parseMultiplicative();
      } else {
        return value;
      }
      this.assertFinite(value);
    }
  }

  private parseMultiplicative(): number {
    let value = this.parseUnary();
    while (true) {
      if (this.consume("*")) {
        value *= this.parseUnary();
      } else if (this.consume("/")) {
        const divisor = this.parseUnary();
        if (divisor === 0) {
          throw new Error("Division by zero is not allowed.");
        }
        value /= divisor;
      } else if (this.consume("%")) {
        const divisor = this.parseUnary();
        if (divisor === 0) {
          throw new Error("Modulo by zero is not allowed.");
        }
        value %= divisor;
      } else {
        return value;
      }
      this.assertFinite(value);
    }
  }

  private parseUnary(): number {
    if (this.consume("+")) {
      return this.parseUnary();
    }
    if (this.consume("-")) {
      return -this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    if (!this.consume("^")) {
      return base;
    }
    return this.assertFinite(Math.pow(base, this.parseUnary()));
  }

  private parsePrimary(): number {
    if (this.consume("(")) {
      this.depth += 1;
      if (this.depth > 64) {
        throw new Error("Expression nesting is too deep.");
      }
      const value = this.parseAdditive();
      if (!this.consume(")")) {
        throw new Error("Expected a closing parenthesis.");
      }
      this.depth -= 1;
      return value;
    }

    const remaining = this.expression.slice(this.position);
    const number = remaining.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (!number) {
      throw new Error("Expected a number.");
    }
    this.position += number[0].length;
    return this.assertFinite(Number(number[0]));
  }

  private consume(character: string): boolean {
    this.skipWhitespace();
    if (this.expression[this.position] !== character) {
      return false;
    }
    this.position += 1;
    return true;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.expression[this.position] ?? "")) {
      this.position += 1;
    }
  }

  private assertFinite(value: number): number {
    if (!Number.isFinite(value)) {
      throw new Error("Expression result is not a finite number.");
    }
    return value;
  }
}

export function evaluateExpression(expression: string): number {
  return new MathExpressionParser(expression).parse();
}

export function createUtilsServer(): McpServer {
  const server = new McpServer({
    name: "mcp-utils",
    version: "1.0.0",
  });

  server.registerTool(
    "current_time",
    {
      description: "Return the current time in UTC using ISO 8601 format.",
      inputSchema: emptyInputSchema.shape,
    },
    async () => ({
      content: [{ type: "text", text: new Date().toISOString() }],
    }),
  );

  server.registerTool(
    "calculate",
    {
      description:
        "Evaluate a basic arithmetic expression with parentheses, unary signs, +, -, *, /, %, and ^. No variables or functions are supported.",
      inputSchema: {
        expression: z
          .string()
          .trim()
          .min(1)
          .max(256)
          .describe("Arithmetic expression, for example (12 + 3) * 4 / 2."),
      },
    },
    async ({ expression }) => {
      try {
        return {
          content: [{ type: "text", text: String(evaluateExpression(expression)) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : "Invalid expression.",
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "search",
    {
      description: "Search the built-in collection of short reference facts.",
      inputSchema: {
        query: z.string().trim().min(1).max(200).describe("Text to find in the built-in facts."),
      },
    },
    async ({ query }) => {
      const normalizedQuery = query.toLocaleLowerCase();
      const matches = facts.filter((fact) => fact.toLocaleLowerCase().includes(normalizedQuery));
      return {
        content: [{ type: "text", text: JSON.stringify(matches) }],
      };
    },
  );

  return server;
}
