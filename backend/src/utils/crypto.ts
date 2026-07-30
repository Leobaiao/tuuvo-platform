/**
 * Criptografia AES-256-GCM pra credencial de canal (token GTI, Zernio, MKOM)
 * guardada em `channel_connections.credenciais_enc` / `platform_channel_providers.credenciais_enc`.
 *
 * A chave em CREDENTIALS_ENCRYPTION_KEY tem que decodificar (base64) pra
 * exatamente 32 bytes — é validado em getKey(), então um erro de configuração
 * falha alto (na inicialização/no primeiro uso), não silenciosamente.
 */
import crypto from "crypto";
import { env } from "../config/env";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const key = Buffer.from(env.credentialsEncryptionKey, "base64");
  if (key.length !== 32) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY precisa decodificar para exatamente 32 bytes"
    );
  }
  return key;
}

/** Formato do resultado: iv(12 bytes) | authTag(16 bytes) | texto cifrado */
export function encryptCredential(plainText: string): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptCredential(blob: Buffer): string {
  const iv = blob.subarray(0, 12);
  const authTag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
