/**
 * Medição automática de consumo cobrável (arquitetura v2, seção 14.3).
 * Fecha o gap identificado: antes disso, `valor_consumo_rcs` e
 * `valor_consumo_whatsapp_oficial` em `faturamento_mensal` eram só número
 * digitado à mão — nada contava as mensagens de verdade.
 *
 * Distingue CUSTO (o que a Meta/MKOM cobra da TUUVO) de RECEITA (o que a
 * TUUVO cobra do tenant) — são dois números diferentes, vindos das colunas
 * `custo_unitario` e `preco_unitario` de `tarifas_canal` (seção 14.5).
 * Hoje ambos são valores DUMMY — a estrutura de cálculo já está correta,
 * só os números exatos aguardam confirmação.
 */
import { pool } from "../db/pool";

interface ConsumoPorCategoria {
  canal: string;
  categoria: string;
  quantidade: number;
  custoUnitario: number;
  precoUnitario: number;
  custoTotal: number;
  receitaTotal: number;
}

export async function calcularConsumoMensal(
  tenantId: string,
  mesReferencia: string // "2026-07-01"
): Promise<{
  totalCustoRcs: number; totalReceitaRcs: number;
  totalCustoWhatsappOficial: number; totalReceitaWhatsappOficial: number;
  detalhe: ConsumoPorCategoria[];
}> {
  const inicio = mesReferencia;
  const fim = new Date(new Date(mesReferencia).getFullYear(), new Date(mesReferencia).getMonth() + 1, 1)
    .toISOString()
    .slice(0, 10);

  const contagem = await pool.query(
    `SELECT cc.tipo AS canal, m.categoria_cobranca AS categoria, COUNT(*) AS quantidade
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     JOIN channel_connections cc ON cc.id = c.channel_connection_id
     WHERE m.tenant_id = $1 AND m.categoria_cobranca IS NOT NULL
       AND m.enviado_em >= $2 AND m.enviado_em < $3
       AND cc.tipo IN ('whatsapp_zernio', 'rcs')
     GROUP BY cc.tipo, m.categoria_cobranca`,
    [tenantId, inicio, fim]
  );

  const detalhe: ConsumoPorCategoria[] = [];
  let totalCustoRcs = 0, totalReceitaRcs = 0;
  let totalCustoWhatsappOficial = 0, totalReceitaWhatsappOficial = 0;

  for (const row of contagem.rows) {
    const canalTarifa = row.canal === "whatsapp_zernio" ? "whatsapp_oficial" : "rcs";
    const tarifa = await pool.query(
      `SELECT custo_unitario, preco_unitario FROM tarifas_canal
       WHERE canal = $1 AND categoria = $2 AND pais = 'BR' AND vigente_desde <= $3
       ORDER BY vigente_desde DESC LIMIT 1`,
      [canalTarifa, row.categoria, mesReferencia]
    );
    const custoUnitario = Number(tarifa.rows[0]?.custo_unitario ?? 0);
    const precoUnitario = Number(tarifa.rows[0]?.preco_unitario ?? 0);
    const quantidade = Number(row.quantidade);
    const custoTotal = custoUnitario * quantidade;
    const receitaTotal = precoUnitario * quantidade;

    detalhe.push({ canal: row.canal, categoria: row.categoria, quantidade, custoUnitario, precoUnitario, custoTotal, receitaTotal });

    if (row.canal === "rcs") { totalCustoRcs += custoTotal; totalReceitaRcs += receitaTotal; }
    if (row.canal === "whatsapp_zernio") { totalCustoWhatsappOficial += custoTotal; totalReceitaWhatsappOficial += receitaTotal; }
  }

  return { totalCustoRcs, totalReceitaRcs, totalCustoWhatsappOficial, totalReceitaWhatsappOficial, detalhe };
}
