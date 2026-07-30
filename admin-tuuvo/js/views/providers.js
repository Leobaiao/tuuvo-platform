import { api } from "../api.js";
import { toast } from "../toast.js";

export function renderProviders(container) {
  container.innerHTML = `
    <div class="page-pad">
      <h1>Credenciais de canal</h1>
      <p class="subtitle">Credenciais a nível de PLATAFORMA (RCS/MKOM, Zernio) — cada tenant só referencia, não guarda token próprio.</p>
      <div id="providers-list" class="card" style="margin-bottom:20px;"></div>
      <div class="card card-pad">
        <strong>Nova credencial</strong>
        <div class="row2" style="margin-top:12px;">
          <div class="field">
            <label>Tipo</label>
            <select id="pv-tipo"><option value="rcs">RCS (MKOM)</option><option value="zernio">Zernio (WhatsApp oficial + redes sociais)</option></select>
          </div>
          <div class="field"><label>Nome</label><input type="text" id="pv-nome" /></div>
        </div>
        <div class="row2">
          <div class="field"><label>Endpoint base</label><input type="text" id="pv-endpoint" placeholder="https://..." /></div>
          <div class="field"><label>Token</label><input type="text" id="pv-token" /></div>
        </div>
        <button class="btn" id="pv-save-btn">Salvar credencial</button>
      </div>
    </div>
  `;

  const listEl = container.querySelector("#providers-list");

  async function load() {
    const rows = await api.get("/tuuvo/channel-providers");
    if (!rows.length) { listEl.innerHTML = `<div class="empty-state">Nenhuma credencial cadastrada.</div>`; return; }
    listEl.innerHTML = rows.map((p) => `
      <div style="display:flex; justify-content:space-between; padding:14px 20px; border-bottom:1px solid var(--border);">
        <div><strong>${p.tipo.toUpperCase()}</strong> — ${escapeHtml(p.nome)}<div style="font-size:12px; color:var(--cinza-texto);">${p.endpoint_base}</div></div>
        <span class="badge ${p.ativo ? "ativo" : "cancelado"}">${p.ativo ? "ativo" : "inativo"}</span>
      </div>`).join("");
  }

  container.querySelector("#pv-save-btn").addEventListener("click", async () => {
    const tipo = container.querySelector("#pv-tipo").value;
    const nome = container.querySelector("#pv-nome").value.trim();
    const endpointBase = container.querySelector("#pv-endpoint").value.trim();
    const token = container.querySelector("#pv-token").value.trim();
    if (!nome || !endpointBase || token.length < 10) return toast("Preencha tudo (token com 10+ caracteres)", "error");
    try {
      await api.post("/tuuvo/channel-providers", { tipo, nome, endpointBase, token });
      toast("Credencial salva");
      load();
    } catch (err) { toast(err.message, "error"); }
  });

  load();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
