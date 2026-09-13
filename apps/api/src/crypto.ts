import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function sealJson(value: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${encode(iv)}.${encode(cipher.getAuthTag())}.${encode(ciphertext)}`;
}

export function openJson<T>(value: string, secret: string): T | null {
  try {
    const [ivText, tagText, ciphertextText] = value.split(".");
    if (!ivText || !tagText || !ciphertextText) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), decode(ivText));
    decipher.setAuthTag(decode(tagText));
    const plaintext = Buffer.concat([decipher.update(decode(ciphertextText)), decipher.final()]).toString("utf8");
    return JSON.parse(plaintext) as T;
  } catch {
    return null;
  }
}

export function stableHash(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
