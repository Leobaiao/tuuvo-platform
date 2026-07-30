import { Router } from "express";
import { pool, withTenantContext } from "../db/pool";

export const publicRouter = Router();

/** Widget de embed consulta isso a partir do site do tenant (sem login). */
publicRouter.get("/widgets/public/:widgetId", async (req, res) => {
  const result = await withTenantContext(null, true, (client) =>
    client.query(
      `SELECT id, tenant_id, nome, config_json AS "configJson" FROM bot_widgets WHERE id = $1 AND publicado = true`,
      [req.params.widgetId]
    )
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Widget não encontrado" });
  res.json(result.rows[0]);
});

/**
 * Planos de preço, consumidos pelo script de embed `tuuvo-pricing.js`
 * (arquitetura v2, seção 8.1) — o site de marketing carrega isso e desenha
 * a seção de preço sozinho, sem precisar de novo deploy quando o preço muda.
 */
publicRouter.get("/planos", async (_req, res) => {
  const result = await pool.query(
    `SELECT id, nome, descricao, preco, preco_sufixo AS "precoSufixo", features, destaque
     FROM planos WHERE ativo = true ORDER BY ordem_exibicao`
  );
  res.json(result.rows);
});
