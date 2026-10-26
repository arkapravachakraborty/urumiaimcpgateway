import { createHash } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

export type UserRole = "ADMIN" | "MEMBER";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface LoginUser extends AuthenticatedUser {
  passwordHash: string;
  disabledAt: Date | null;
}

export interface StoredApiKey {
  id: string;
  revokedAt: Date | null;
  user: AuthenticatedUser & { disabledAt: Date | null };
}

export interface AuthStore {
  findAuthUserById(id: string): Promise<(AuthenticatedUser & { disabledAt: Date | null }) | null>;
  findLoginUserByEmail(email: string): Promise<LoginUser | null>;
  findApiKeyByHash(keyHash: string): Promise<StoredApiKey | null>;
  touchApiKey(id: string, lastUsedAt: Date): Promise<void>;
}

const internalTokenLifetimeSeconds = 60;

export function parseSessionSecret(secret: string | undefined): Uint8Array {
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(userId: string, secret: Uint8Array): Promise<string> {
  return new SignJWT({ purpose: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function createInternalToken(userId: string, secret: Uint8Array): Promise<string> {
  return new SignJWT({ purpose: "internal" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("team-mcp-gateway")
    .setAudience("gateway-mcp")
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${internalTokenLifetimeSeconds}s`)
    .sign(secret);
}

export async function resolveSessionUser(
  token: string | undefined,
  secret: Uint8Array,
  store: AuthStore,
): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  let subject: string;
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      maxTokenAge: "7d",
      requiredClaims: ["exp", "iat", "sub"],
    });
    if (payload.purpose !== "session" || typeof payload.sub !== "string") return null;
    subject = payload.sub;
  } catch {
    return null;
  }
  const user = await store.findAuthUserById(subject);
  if (!user || user.disabledAt) return null;
  return { id: user.id, email: user.email, role: user.role };
}

export async function authenticateMcpRequest(
  authorization: string | undefined,
  secret: Uint8Array,
  store: AuthStore,
): Promise<AuthenticatedUser | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  if (token.startsWith("mcpgw_")) {
    const keyHash = hashApiKey(token);
    const apiKey = await store.findApiKeyByHash(keyHash);
    if (!apiKey || apiKey.revokedAt || apiKey.user.disabledAt) return null;
    await store.touchApiKey(apiKey.id, new Date());
    return {
      id: apiKey.user.id,
      email: apiKey.user.email,
      role: apiKey.user.role,
    };
  }

  let subject: string;
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: "team-mcp-gateway",
      audience: "gateway-mcp",
      maxTokenAge: `${internalTokenLifetimeSeconds}s`,
      requiredClaims: ["exp", "iat", "sub"],
    });
    if (
      payload.purpose !== "internal" ||
      typeof payload.sub !== "string" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.exp - payload.iat > internalTokenLifetimeSeconds
    ) {
      return null;
    }
    subject = payload.sub;
  } catch {
    return null;
  }
  const user = await store.findAuthUserById(subject);
  if (!user || user.disabledAt) return null;
  return { id: user.id, email: user.email, role: user.role };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `mcp_gateway_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=604800",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [
    "mcp_gateway_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  const cookie = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("mcp_gateway_session="));
  if (!cookie) return undefined;
  try {
    return decodeURIComponent(cookie.slice("mcp_gateway_session=".length));
  } catch {
    return undefined;
  }
}
