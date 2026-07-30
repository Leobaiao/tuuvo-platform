import { api } from "../api.js";

export function renderDashboard(container) {
  container.innerHTML = `
    <div class="page-pad">
      <h1>Dashboard</h1>
      <p class="subtitle">Visão geral da plataforma — arquitetura v2, seção 8.2.</p>
      <div id="kpis" class="kpi-grid"></div>
      <div class="card card-pad">
        <strong>Receita — últimos 3 meses</strong>
        <div id="grafico" style="margin-top:16px;"></div>
      </div>
    </div>
  `;

  const kpisEl = container.querySelector("#kpis");
  const graficoEl = container.querySelector("#grafico");

  api.get("/tuuvo/dashboard").then((data) => {
    kpisEl.innerHTML = `
      <div class="kpi-card"><div class="kpi-value">${data.tenantsAtivos}</div><div class="kpi-label">Tenants ativos</div></div>
      <div class="kpi-card"><div class="kpi-value">${data.tenantsEmAvaliacao}</div><div class="kpi-label">Em avaliação</div></div>
      <div class="kpi-card"><div class="kpi-value">R$ ${data.faturamentoMes.toLocaleString("pt-BR")}</div><div class="kpi-label">Faturamento do mês</div></div>
      <div class="kpi-card"><div class="kpi-value">R$ ${data.faturamentoTrimestre.toLocaleString("pt-BR")}</div><div class="kpi-label">Faturamento no trimestre</div></div>
    `;

    if (!data.grafico3meses.length) {
      graficoEl.innerHTML = `<div class="empty-state">Sem lançamento de faturamento ainda.</div>`;
      return;
    }
    const max = Math.max(...data.grafico3meses.map((m) => Number(m.receita)), 1);
    graficoEl.innerHTML = `
      <div style="display:flex; align-items:flex-end; gap:16px; height:160px;">
        ${data.grafico3meses.map((m) => {
          const altura = Math.max((Number(m.receita) / max) * 140, 4);
          const mes = new Date(m.mes_referencia).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
          return `
            <div style="display:flex; flex-direction:column; align-items:center; gap:6px;">
              <div style="font-size:11px; color:var(--cinza-texto);">R$ ${Number(m.receita).toLocaleString("pt-BR")}</div>
              <div style="width:48px; height:${altura}px; background:var(--tuuvo-primaria); border-radius:6px 6px 0 0;"></div>
              <div style="font-size:12px; color:var(--cinza-texto);">${mes}</div>
            </div>`;
        }).join("")}
      </div>
    `;
  });
}
