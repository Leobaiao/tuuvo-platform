import { api } from "../api.js";

export function renderRelatorios(container) {
  container.innerHTML = `
    <div class="page-pad">
      <h1>Relatórios</h1>
      <p class="subtitle">Mini-BI da sua operação — período, canal, equipe.</p>
      <div class="row3" style="margin-bottom:20px;">
        <div class="field"><label>De</label><input type="date" id="de" /></div>
        <div class="field"><label>Até</label><input type="date" id="ate" /></div>
        <div class="field" style="display:flex; align-items:flex-end;"><button class="btn" id="filtrar-btn">Filtrar</button></div>
      </div>
      <div id="kpis" class="kpi-grid"></div>
      <div class="row2">
        <div class="card card-pad"><strong>Conversas por canal</strong><div id="por-canal" style="margin-top:12px;"></div></div>
        <div class="card card-pad"><strong>Conversas por equipe</strong><div id="por-equipe" style="margin-top:12px;"></div></div>
      </div>
    </div>
  `;

  const hoje = new Date().toISOString().slice(0, 10);
  const trintaDiasAtras = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  container.querySelector("#de").value = trintaDiasAtras;
  container.querySelector("#ate").value = hoje;

  async function load() {
    const de = container.querySelector("#de").value;
    const ate = container.querySelector("#ate").value;
    const data = await api.get(`/tenant/relatorios/resumo?de=${de}&ate=${ate}`);

    container.querySelector("#kpis").innerHTML = `
      <div class="kpi-card"><div class="kpi-value">${data.resumo.total}</div><div class="kpi-label">Total de conversas</div></div>
      <div class="kpi-card"><div class="kpi-value">${data.resumo.abertas}</div><div class="kpi-label">Abertas</div></div>
      <div class="kpi-card"><div class="kpi-value">${data.resumo.fechadas}</div><div class="kpi-label">Fechadas</div></div>
      <div class="kpi-card"><div class="kpi-value">${data.resumo.tempo_medio_fechamento_segundos ? Math.round(data.resumo.tempo_medio_fechamento_segundos / 60) + "min" : "—"}</div><div class="kpi-label">Tempo médio até fechar</div></div>
    `;

    const barra = (rows, key) => {
      const max = Math.max(...rows.map((r) => Number(r.total)), 1);
      return rows.map((r) => `
        <div style="margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;"><span>${r[key] ?? "sem equipe"}</span><span>${r.total}</span></div>
          <div style="background:var(--bg); border-radius:6px; overflow:hidden;"><div style="width:${(r.total / max) * 100}%; height:8px; background:var(--tuuvo-primaria);"></div></div>
        </div>`).join("");
    };

    container.querySelector("#por-canal").innerHTML = data.porCanal.length ? barra(data.porCanal, "canal") : `<div class="empty-state">Sem dados no período.</div>`;
    container.querySelector("#por-equipe").innerHTML = data.porEquipe.length ? barra(data.porEquipe, "equipe") : `<div class="empty-state">Sem dados no período.</div>`;
  }

  container.querySelector("#filtrar-btn").addEventListener("click", load);
  load();
  return null;
}
