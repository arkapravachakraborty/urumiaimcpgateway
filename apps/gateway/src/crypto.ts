import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function parseEncryptionKey(value: string | undefined): Buffer {
  if (!value) {
    throw new Error("ENCRYPTION_KEY is required.");
  }

  const key =
    /^[a-fA-F0-9]{64}$/.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters or base64.");
  }
  return key;
}

export function decryptCredential(encrypted: string, key: Buffer): string {
  const [version, ivValue, tagValue, ciphertextValue, extra] = encrypted.split(":");
  if (
    version !== "v1" ||
    !ivValue ||
    !tagValue ||
    ciphertextValue === undefined ||
    extra !== undefined
  ) {
    throw new Error("Encrypted credential has an unsupported format.");
  }

  const iv = Buffer.from(ivValue, "base64");
  const tag = Buffer.from(tagValue, "base64");
  const ciphertext = Buffer.from(ciphertextValue, "base64");
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error("Encrypted credential has invalid AES-GCM parameters.");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function encryptCredential(credential: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(credential, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ciphertext.toString("base64")}`;
}
