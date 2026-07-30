/**
 * Configuração central de ambiente.
 *
 * Ponto de customização: qualquer variável nova (ex.: uma chave de API de um
 * canal novo) deve entrar aqui, nunca lida direto via `process.env` em outro
 * arquivo — mantém um lugar só pra saber "quais variáveis de ambiente esse
 * projeto usa".
 */
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

  // Autenticação — dois segredos JWT diferentes por design: um token de
  // tuuvo_users nunca deve funcionar numa rota de tenant, e vice-versa,
  // mesmo que alguém tente reaproveitar o token por engano ou má-fé.
  jwtSecretTenant: required("JWT_SECRET_TENANT"),
  jwtSecretTuuvo: required("JWT_SECRET_TUUVO"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",

  credentialsEncryptionKey: required("CREDENTIALS_ENCRYPTION_KEY"),

  // WhatsApp não-oficial — GTI (driver trocável, ver drivers/WhatsAppGtiDriver.ts)
  gtiBaseUrl: process.env.GTI_BASE_URL ?? "https://api.gtiapi.workers.dev",

  // RCS — broker MKOM (SMS foi removido do escopo, ver arquitetura v2 seção 3.5)
  mkomRcsBaseUrl:
    process.env.MKOM_RCS_BASE_URL ??
    "https://sms.mkmservice.com/sms/api/transmission/v1",

  // Zernio — WhatsApp oficial + redes sociais, um driver só (seção 3.3)
  zernioBaseUrl: process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1",

  // E-mail — IMAP/SMTP da caixa que o driver de e-mail usa (seção 3.7)
  emailImapHost: process.env.EMAIL_IMAP_HOST,
  emailSmtpHost: process.env.EMAIL_SMTP_HOST,

  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
};
