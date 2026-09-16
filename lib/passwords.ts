import { randomBytes, timingSafeEqual, webcrypto } from "node:crypto";

const encoder = new TextEncoder();
const CURRENT_PASSWORD_VERSION = "v2";
const PASSWORD_ITERATIONS: Readonly<Record<string, number>> = {
  v1: 120_000,
  v2: 600_000,
};

function base64Url(value: Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

async function derivePassword(password: string, salt: string, iterations: number) {
  const key = await webcrypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations, hash: "SHA-256" },
    key,
    256,
  );
  return Buffer.from(bits);
}

export async function hashPassword(password: string) {
  const salt = base64Url(randomBytes(16));
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS[CURRENT_PASSWORD_VERSION]);
  return `${CURRENT_PASSWORD_VERSION}.${salt}.${base64Url(hash)}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [version, salt, expected, extra] = storedHash.split(".");
  const iterations = PASSWORD_ITERATIONS[version];
  if (!iterations || !salt || !expected || extra || !/^[A-Za-z0-9_-]+$/.test(salt) || !/^[A-Za-z0-9_-]+$/.test(expected)) return false;

  const expectedBytes = Buffer.from(expected, "base64url");
  if (expectedBytes.length !== 32) return false;
  const actualBytes = await derivePassword(password, salt, iterations);
  return timingSafeEqual(expectedBytes, actualBytes);
}

export function passwordHashNeedsUpgrade(storedHash: string) {
  return !storedHash.startsWith(`${CURRENT_PASSWORD_VERSION}.`);
}

export function validatePassword(password: string) {
  return password.length >= 8 && password.length <= 200;
}
