import { Router } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { loginTenant, gerarResetToken, redefinirSenhaComToken } from "../services/authTenant.service";
import { requireTenantAuthOrApiKey } from "../middleware/auth";
import { pool } from "../db/pool";
import { env } from "../config/env";

export const authTenantRouter = Router();

const loginSchema = z.object({ email: z.string().email(), senha: z.string().min(6) });

authTenantRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const { token, user } = await loginTenant(parsed.data.email, parsed.data.senha);
    res.json({ token, user });
  } catch {
    res.status(401).json({ error: "Credenciais inválidas" });
  }
});

const esqueciSchema = z.object({ email: z.string().email() });

authTenantRouter.post("/esqueci-senha", async (req, res) => {
  const parsed = esqueciSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const token = await gerarResetToken(parsed.data.email);
  // TODO produção: disparar e-mail de verdade com o link de reset (SMTP,
  // ver EmailDriver.ts pra reaproveitar a mesma infra de envio).
  if (token) console.log(`[dev] link de reset pra ${parsed.data.email}: /redefinir-senha?token=${token}`);
  // Resposta genérica sempre — não revela se o e-mail existe (seção 6).
  res.json({ ok: true, message: "Se o e-mail existir, você vai receber um link de redefinição." });
});

const redefinirSchema = z.object({ token: z.string(), novaSenha: z.string().min(8) });

authTenantRouter.post("/redefinir-senha", async (req, res) => {
  const parsed = redefinirSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const ok = await redefinirSenhaComToken(parsed.data.token, parsed.data.novaSenha);
  if (!ok) return res.status(400).json({ error: "Token inválido ou expirado" });
  res.json({ ok: true });
});

/**
 * Emite um JWT de agente específico pra uso no modo embed (arquitetura v2,
 * seção 13.4) — é assim que uma plataforma externa (AltDesk sendo a
 * primeira, mas o mecanismo não é exclusivo dela — qualquer plataforma com
 * uma API key ativa pode usar o mesmo caminho) consegue o token pra passar
 * em `?token=...` no iframe do painel de conversas.
 *
 * Protegido por API key (requireTenantAuthOrApiKey) — quem chama isso é o
 * BACKEND da plataforma externa, não o navegador do agente diretamente.
 * Fluxo real:
 *   1. Agente loga na plataforma externa normalmente (autenticação deles, não nossa)
 *   2. Backend dela chama esta rota com a API key + o e-mail do agente
 *   3. Devolve um JWT de curta duração (1h) pra montar a URL do iframe
 *   4. Plataforma externa injeta esse token no <iframe src=".../?embed=1&token=...">
 *
 * Cada chamada fica registrada em audit_log com o NOME da API key usada —
 * com múltiplas integrações ativas ao mesmo tempo (AltDesk, e outras que
 * vierem depois), dá pra saber depois qual plataforma pediu qual token,
 * pra qual agente, e quando — sem isso, debugar "por que esse agente tem
 * acesso" com 2+ integrações rodando ficaria às cegas.
 *
 * Exige que o e-mail já exista como usuário TUUVO daquele tenant — não cria
 * usuário novo aqui. Ver seção 13.4 pra decisão de como isso é provisionado
 * (fora do escopo desta rota, é decisão de produto por integração).
 */
const emitirTokenEmbedSchema = z.object({ email: z.string().email() });

authTenantRouter.post("/emitir-token-embed", requireTenantAuthOrApiKey, async (req, res) => {
  const parsed = emitirTokenEmbedSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const result = await pool.query(
    `SELECT id, tenant_id, papel FROM users WHERE tenant_id = $1 AND email = $2 AND status = 'ativo'`,
    [req.tenantAuth!.tenantId, parsed.data.email]
  );
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: "Usuário não encontrado neste tenant" });

  const token = jwt.sign(
    { userId: user.id, tenantId: user.tenant_id, papel: user.papel, escopo: "tenant" },
    env.jwtSecretTenant,
    { expiresIn: "1h" } // curto de propósito — token de embed, não de sessão longa
  );

  // Rastro de auditoria: qual API key (= qual integração/plataforma externa)
  // pediu token pra qual agente. req.tenantAuth.userId aqui é o id da PRÓPRIA
  // api_key (ver middleware/auth.ts) quando a chamada veio por API key —
  // buscamos o nome dela pra deixar o log legível por humano.
  const chaveInfo = await pool.query(`SELECT nome FROM api_keys WHERE id = $1`, [req.tenantAuth!.userId]);
  await pool.query(
    `INSERT INTO audit_log (tenant_id, user_id, acao, alvo, detalhes) VALUES ($1, $2, 'emitir_token_embed', $3, $4)`,
    [
      user.tenant_id, user.id, user.email,
      { via_integracao: chaveInfo.rows[0]?.nome ?? "login direto (sem API key)" },
    ]
  );

  res.json({ token, expiraEm: "1h" });
});
