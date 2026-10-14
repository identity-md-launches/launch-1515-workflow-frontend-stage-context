import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { isAddress, type Address, type Hex } from "viem";

export const ITERATIONS = 200_000;
export type Secrets = {
  privateKey: Hex;
  apiKey?: string;
  providerBinding?: string;
};
export type Envelope = {
  version: 1;
  iterations: 200000;
  salt: string;
  iv: string;
  ciphertext: string;
};
export type VaultRecord = {
  address: Address;
  exported: boolean;
  encrypted: Envelope;
};
const bytes = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const base64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
async function derive(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptSecrets(
  secret: Secrets,
  passphrase: string,
  context: string,
): Promise<Envelope> {
  if (passphrase.length < 12)
    throw Error("Use a passphrase of at least 12 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    key,
    new TextEncoder().encode(JSON.stringify(secret)),
  );
  return {
    version: 1,
    iterations: ITERATIONS,
    salt: base64(salt),
    iv: base64(iv),
    ciphertext: base64(new Uint8Array(ciphertext)),
  };
}
export async function decryptSecrets(
  value: Envelope,
  passphrase: string,
  context: string,
): Promise<Secrets> {
  try {
    if (value.version !== 1 || value.iterations !== ITERATIONS) throw Error();
    const salt = bytes(value.salt),
      iv = bytes(value.iv);
    if (
      salt.length !== 16 ||
      iv.length !== 12 ||
      value.ciphertext.length > 20_000
    )
      throw Error();
    const key = await derive(passphrase, salt);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(context),
      },
      key,
      bytes(value.ciphertext),
    );
    const secret: Secrets = JSON.parse(new TextDecoder().decode(plaintext));
    privateKeyToAccount(secret.privateKey); // Validate before retaining anything in memory.
    if (secret.apiKey !== undefined && typeof secret.apiKey !== "string")
      throw Error();
    if (
      secret.providerBinding !== undefined &&
      typeof secret.providerBinding !== "string"
    )
      throw Error();
    return secret;
  } catch {
    throw Error("Unable to unlock. Check your passphrase and saved key.");
  }
}
export function newAgent() {
  const privateKey = generatePrivateKey();
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}
export function storageKey(
  chain: number,
  desk: Address,
  holder: Address,
  id: bigint,
) {
  return `hic:autopilot:v1:${chain}:${desk.toLowerCase()}:${holder.toLowerCase()}:${id}`;
}
export function loadVault(key: string): VaultRecord | undefined {
  const raw = localStorage.getItem(key + ":vault");
  if (!raw) return undefined;
  const record = JSON.parse(raw) as VaultRecord;
  if (
    !record ||
    !isAddress(record.address, { strict: false }) ||
    typeof record.exported !== "boolean" ||
    !record.encrypted ||
    record.encrypted.version !== 1 ||
    record.encrypted.iterations !== ITERATIONS ||
    typeof record.encrypted.ciphertext !== "string"
  )
    throw Error("Invalid saved agent key.");
  return record;
}
export class VaultConflictError extends Error {
  constructor() {
    super(
      "Saved keys changed in another tab. Unlock the saved agent key and try again.",
    );
  }
}
export const sameVault = (a?: VaultRecord, b?: VaultRecord) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Use a separate, short-lived lock from the card's running-engine lock. */
export async function withVaultLock<T>(
  key: string,
  operation: (current: VaultRecord | undefined) => Promise<T>,
): Promise<T> {
  if (!navigator.locks)
    throw Error(
      "This browser does not support tab locking. Use a current browser to save agent keys safely.",
    );
  return navigator.locks.request(key + ":vault", () =>
    operation(loadVault(key)),
  );
}

/** Call inside withVaultLock. Recheck after asynchronous encryption, before writing. */
export function saveVault(
  key: string,
  record: VaultRecord,
  expected: VaultRecord | undefined,
) {
  if (!sameVault(loadVault(key), expected)) throw new VaultConflictError();
  localStorage.setItem(key + ":vault", JSON.stringify(record));
}
export function redact(
  text: string,
  secrets?: Secrets,
  passphrase?: string,
  limit = 600,
) {
  let result = text;
  for (const secret of [secrets?.privateKey, secrets?.apiKey, passphrase]) {
    if (secret) result = result.split(secret).join("[redacted]");
  }
  return result.replace(/0x[a-fA-F0-9]{64}\b/g, "[redacted]").slice(0, limit);
}
