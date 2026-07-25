import { getServerEnv } from "@/integrations/supabase/runtime-env.server";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey() {
  const raw = getServerEnv("META_TENANT_CREDENTIALS_KEY")?.trim();
  if (!raw) throw new Error("Falta configurar META_TENANT_CREDENTIALS_KEY nos Secrets do Worker.");
  const bytes = base64ToBytes(raw);
  if (bytes.byteLength !== 32) throw new Error("META_TENANT_CREDENTIALS_KEY deve conter uma chave Base64 de 32 bytes.");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypts provider tokens before they enter the database. */
export async function encryptMetaAccessToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), encoder.encode(token));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

/** Decryption is server-only and is never exposed to a browser bundle. */
export async function decryptMetaAccessToken(payload: string) {
  const [version, ivValue, ciphertextValue] = payload.split(".");
  if (version !== "v1" || !ivValue || !ciphertextValue) throw new Error("Credencial WhatsApp inválida.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivValue) },
    await encryptionKey(),
    base64ToBytes(ciphertextValue),
  );
  return decoder.decode(plaintext);
}
