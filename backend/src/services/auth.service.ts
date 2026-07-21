import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import { env } from "../config/env";

export interface AuthTokenPayload {
  userId: string;
  tenantId: string | null;
  papel: "superadmin" | "admin" | "supervisor" | "agente";
}

export async function login(email: string, senha: string): Promise<{
  token: string;
  user: AuthTokenPayload & { nome: string | null; email: string };
}> {
  // Login não passa pelo contexto de RLS (ainda não sabemos o tenant) —
  // busca direta, sem SET app.current_tenant. Por isso essa é uma das poucas
  // queries do sistema que roda fora de withTenantContext.
  const result = await pool.query(
    `SELECT id, tenant_id, email, senha_hash, nome, papel
     FROM users WHERE email = $1 AND status = 'ativo'`,
    [email]
  );

  const user = result.rows[0];
  if (!user) throw new Error("Credenciais inválidas");

  const valid = await bcrypt.compare(senha, user.senha_hash);
  if (!valid) throw new Error("Credenciais inválidas");

  const payload: AuthTokenPayload = {
    userId: user.id,
    tenantId: user.tenant_id,
    papel: user.papel,
  };

  const token = jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as jwt.SignOptions);

  return { token, user: { ...payload, nome: user.nome, email: user.email } };
}

export async function hashPassword(senha: string): Promise<string> {
  return bcrypt.hash(senha, 10);
}
