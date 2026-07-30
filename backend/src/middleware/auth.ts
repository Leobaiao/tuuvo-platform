/**
 * Dois middlewares de autenticação SEPARADOS, um pra cada app:
 *  - requireTenantAuth: valida token de `users` (Administração do Tenant)
 *  - requireTuuvoAuth: valida token de `tuuvo_users` (Administração TUUVO)
 * Cada um usa seu próprio JWT_SECRET (env.jwtSecretTenant / env.jwtSecretTuuvo)
 * — um token de um tipo simplesmente FALHA ao validar no middleware do outro
 * tipo (chave errada = assinatura inválida), então não tem como um token de
 * tenant "vazar" acesso à Administração TUUVO por engano.
 */
import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { TenantAuthPayload } from "../services/authTenant.service";
import { TuuvoAuthPayload } from "../services/authTuuvo.service";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenantAuth?: TenantAuthPayload;
      tuuvoAuth?: TuuvoAuthPayload;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

export function requireTenantAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Token ausente" });
  try {
    const payload = jwt.verify(token, env.jwtSecretTenant) as TenantAuthPayload;
    req.tenantAuth = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

export function requireTuuvoAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Token ausente" });
  try {
    const payload = jwt.verify(token, env.jwtSecretTuuvo) as TuuvoAuthPayload;
    req.tuuvoAuth = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

/**
 * Aceita autenticação por X-API-Key OU pelo JWT normal — pensado pra
 * aplicação EXTERNA do tenant chamar /conversations sem depender de login
 * humano (JWT expira em horas; a API key não expira até ser revogada).
 * Usa a MESMA forma de request.tenantAuth do requireTenantAuth normal, então
 * o resto do código (rotas, requireTenantPapel) não precisa saber qual dos
 * dois métodos foi usado.
 */
export async function requireTenantAuthOrApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"] as string | undefined;
  if (!apiKey) return requireTenantAuth(req, res, next);

  const bcrypt = await import("bcryptjs");
  const { pool } = await import("../db/pool");
  const prefixo = apiKey.slice(0, 8);
  const candidatos = await pool.query(
    `SELECT id, tenant_id, chave_hash FROM api_keys WHERE prefixo = $1 AND ativo = true`,
    [prefixo]
  );
  for (const row of candidatos.rows) {
    if (await bcrypt.compare(apiKey, row.chave_hash)) {
      req.tenantAuth = { userId: row.id, tenantId: row.tenant_id, papel: "admin", escopo: "tenant" };
      pool.query(`UPDATE api_keys SET ultima_utilizacao = now() WHERE id = $1`, [row.id]).catch(() => {});
      return next();
    }
  }
  return res.status(401).json({ error: "API key inválida" });
}

export function requireTenantPapel(...papeis: TenantAuthPayload["papel"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.tenantAuth || !papeis.includes(req.tenantAuth.papel)) {
      return res.status(403).json({ error: "Sem permissão para esta ação" });
    }
    next();
  };
}

/** Atalho: exige papel "superadmin" dentro da Administração TUUVO (não confundir com o superadmin de tenant, que não existe mais na v2 — ver seção 8.0). */
export function requireTuuvoSuperadmin(req: Request, res: Response, next: NextFunction) {
  if (req.tuuvoAuth?.papel !== "superadmin") {
    return res.status(403).json({ error: "Ação restrita a superadmin do time TUUVO" });
  }
  next();
}
