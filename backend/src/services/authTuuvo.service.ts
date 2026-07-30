/**
 * Login do TIME TUUVO — tabela `tuuvo_users`, separada da tabela `users` de
 * tenant (arquitetura v2, seção 8.0). Usa um JWT_SECRET diferente do de
 * tenant por design: um token daqui nunca deve funcionar numa rota de
 * tenant, mesmo por engano.
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool";
import { env } from "../config/env";

export interface TuuvoAuthPayload {
  userId: string;
  papel: "superadmin" | "operador";
  escopo: "tuuvo"; // marca explícita — diferencia de um TenantAuthPayload no middleware
}

export async function loginTuuvo(email: string, senha: string): Promise<{
  token: string;
  user: TuuvoAuthPayload & { nome: string | null; email: string };
}> {
  const result = await pool.query(
    `SELECT id, email, senha_hash, nome, papel FROM tuuvo_users WHERE email = $1 AND status = 'ativo'`,
    [email]
  );
  const user = result.rows[0];
  if (!user) throw new Error("Credenciais inválidas");

  const valid = await bcrypt.compare(senha, user.senha_hash);
  if (!valid) throw new Error("Credenciais inválidas");

  const payload: TuuvoAuthPayload = { userId: user.id, papel: user.papel, escopo: "tuuvo" };
  const token = jwt.sign(payload, env.jwtSecretTuuvo, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);

  return { token, user: { ...payload, nome: user.nome, email: user.email } };
}

export async function hashPassword(senha: string): Promise<string> {
  return bcrypt.hash(senha, 10);
}
