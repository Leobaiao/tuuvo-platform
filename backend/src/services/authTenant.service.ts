/**
 * Login de usuário de TENANT — tabela `users`. Separado de `authTuuvo.service.ts`
 * (login do time TUUVO), com seu próprio JWT_SECRET.
 */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import { env } from "../config/env";

export interface TenantAuthPayload {
  userId: string;
  tenantId: string;
  papel: "admin" | "supervisor" | "agente";
  escopo: "tenant";
}

export async function loginTenant(email: string, senha: string): Promise<{
  token: string;
  user: TenantAuthPayload & { nome: string | null; email: string };
}> {
  const result = await pool.query(
    `SELECT id, tenant_id, email, senha_hash, nome, papel FROM users WHERE email = $1 AND status = 'ativo'`,
    [email]
  );
  const user = result.rows[0];
  if (!user) throw new Error("Credenciais inválidas");

  const valid = await bcrypt.compare(senha, user.senha_hash);
  if (!valid) throw new Error("Credenciais inválidas");

  const payload: TenantAuthPayload = {
    userId: user.id, tenantId: user.tenant_id, papel: user.papel, escopo: "tenant",
  };
  const token = jwt.sign(payload, env.jwtSecretTenant, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);

  return { token, user: { ...payload, nome: user.nome, email: user.email } };
}

/** Gera token de "esqueci minha senha", válido por 2h — arquitetura v2, seção 6. */
export async function gerarResetToken(email: string): Promise<string | null> {
  const token = crypto.randomBytes(32).toString("hex");
  const expira = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const result = await pool.query(
    `UPDATE users SET reset_token = $1, reset_token_expira = $2 WHERE email = $3 RETURNING id`,
    [token, expira, email]
  );
  // Não revela se o e-mail existe ou não (evita enumeração de usuário) —
  // quem chama esta função decide o que fazer com `null` (ex.: responder
  // sempre "se o e-mail existir, você recebe um link", igual funcione ou não).
  return result.rows[0] ? token : null;
}

export async function redefinirSenhaComToken(token: string, novaSenha: string): Promise<boolean> {
  const senhaHash = await hashPassword(novaSenha);
  const result = await pool.query(
    `UPDATE users SET senha_hash = $1, reset_token = NULL, reset_token_expira = NULL
     WHERE reset_token = $2 AND reset_token_expira > now() RETURNING id`,
    [senhaHash, token]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function hashPassword(senha: string): Promise<string> {
  return bcrypt.hash(senha, 10);
}
