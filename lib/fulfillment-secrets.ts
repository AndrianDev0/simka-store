const encoder = new TextEncoder();
const decoder = new TextDecoder();

function secretMaterial() {
  const value = process.env.FULFILLMENT_ENCRYPTION_KEY;
  if (!value || value.length < 32) throw new Error("FULFILLMENT_ENCRYPTION_KEY_NOT_CONFIGURED");
  return value;
}

async function encryptionKey() {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`SIMKA fulfillment credentials v1\0${secretMaterial()}`),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function encode(value: Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string) {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

/** Encrypts eSIM credentials before they are persisted in PostgreSQL. */
export async function encryptFulfillmentSecret(value: string, orderItemId: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 4000) throw new Error("INVALID_FULFILLMENT_SECRET");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(orderItemId) },
    await encryptionKey(),
    encoder.encode(normalized),
  );
  return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}

/** Decrypts only when an administrator explicitly resends the delivery email. */
export async function decryptFulfillmentSecret(value: string, orderItemId: string) {
  const [version, encodedIv, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext) throw new Error("INVALID_ENCRYPTED_FULFILLMENT_SECRET");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(encodedIv), additionalData: encoder.encode(orderItemId) },
    await encryptionKey(),
    decode(encodedCiphertext),
  );
  return decoder.decode(plaintext);
}
