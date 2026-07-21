import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AuthTokenPayload } from "../services/auth.service";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthTokenPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token ausente" });
  }
  try {
    const token = header.slice("Bearer ".length);
    const payload = jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
    req.auth = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

export function requirePapel(...papeis: AuthTokenPayload["papel"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !papeis.includes(req.auth.papel)) {
      return res.status(403).json({ error: "Sem permissão para esta ação" });
    }
    next();
  };
}

/** Atalho: exige que seja superadmin (usado nas rotas /superadmin/*). */
export const requireSuperadmin = requirePapel("superadmin");
