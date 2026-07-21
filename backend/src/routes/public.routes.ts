import { Router } from "express";
import { withTenantContext } from "../db/pool";

/**
 * Rota pública, sem autenticação — é o que o SDK de embed (widget/tuuvo-widget.js)
 * chama a partir do site do cliente para saber cores, textos, avatar etc.
 * Só devolve widgets publicados (nunca rascunho).
 */
export const publicRouter = Router();

publicRouter.get("/widgets/public/:widgetId", async (req, res) => {
  // Aqui não temos tenantId de um JWT — o próprio widget precisa informar,
  // então a query já filtra por id do widget + publicado = true, sem
  // depender do contexto de RLS (roda como leitura ampla, mas só de dados
  // já marcados como públicos por design).
  const result = await withTenantContext(null, true, (client) =>
    client.query(
      `SELECT id, tenant_id, nome, config_json AS "configJson"
       FROM bot_widgets WHERE id = $1 AND publicado = true`,
      [req.params.widgetId]
    )
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Widget não encontrado" });
  res.json(result.rows[0]);
});
