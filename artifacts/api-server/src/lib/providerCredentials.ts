import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const secret = process.env.PROVIDER_KEY_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) throw new Error("Provider credentials cannot be encrypted until a server secret is configured.");
  return createHash("sha256").update(secret).digest();
}

export function encryptProviderCredential(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([iv, ciphertext]).toString("base64");
}

export function decryptProviderCredential(value: string): string {
  const source = Buffer.from(value, "base64");
  if (source.length < 29) throw new Error("Stored provider credential is invalid. Re-enter the API key in My Providers.");
  const iv = source.subarray(0, 12);
  const tag = source.subarray(source.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(source.subarray(12, -16)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Imported provider API key cannot be decrypted. Re-enter it once in My Providers.");
  }
}