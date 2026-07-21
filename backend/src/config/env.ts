import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export const env = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  credentialsEncryptionKey: required("CREDENTIALS_ENCRYPTION_KEY"),
  gtiBaseUrl: process.env.GTI_BASE_URL ?? "https://api.gtiapi.workers.dev",
  mkomSmsBaseUrl:
    process.env.MKOM_SMS_BASE_URL ??
    "https://sms.mkmservice.com/sms/api/transmission/v1",
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
};
