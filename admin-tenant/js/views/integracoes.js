import { api } from "../api.js";
import { toast } from "../toast.js";

export function renderIntegracoes(container) {
  container.innerHTML = `
    <div class="page-pad">
      <h1>Integrações</h1>
      <p class="subtitle">Chave de API pra sua aplicação externa usar os canais conectados (WhatsApp, RCS, e-mail) sem depender de login humano.</p>
      <div class="card" style="margin-bottom:20px;"><div id="keys-list"></div></div>
      <div class="card card-pad">
        <strong>Nova chave</strong>
        <div class="field" style="margin-top:12px;"><label>Nome (pra identificar depois)</label><input type="text" id="nome" placeholder="Ex.: Integração CRM interno" /></div>
        <button class="btn" id="create-btn">Gerar chave</button>
        <div id="new-key-result" style="margin-top:14px;"></div>
      </div>
    </div>
  `;

  const listEl = container.querySelector("#keys-list");
  const resultEl = container.querySelector("#new-key-result");

  async function load() {
    const rows = await api.get("/tenant/api-keys");
    listEl.innerHTML = rows.length
      ? rows.map((k) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px; border-bottom:1px solid var(--border);">
          <div><strong>${escapeHtml(k.nome)}</strong><div style="font-size:12px; color:var(--cinza-texto); font-family:monospace;">${k.prefixo}••••••••••••••••</div></div>
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="badge ${k.ativo ? "ativo" : "cancelado"}">${k.ativo ? "ativa" : "revogada"}</span>
            ${k.ativo ? `<button class="btn danger btn-sm revoke-btn" data-id="${k.id}">Revogar</button>` : ""}
          </div>
        </div>`).join("")
      : `<div class="empty-state">Nenhuma chave gerada ainda.</div>`;

    listEl.querySelectorAll(".revoke-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Revogar essa chave? Aplicações que usam ela param de funcionar imediatamente.")) return;
        try { await api.patch(`/tenant/api-keys/${btn.dataset.id}/revogar`, {}); toast("Chave revogada"); load(); }
        catch (err) { toast(err.message, "error"); }
      });
    });
  }

  container.querySelector("#create-btn").addEventListener("click", async () => {
    const nome = container.querySelector("#nome").value.trim();
    if (!nome) return toast("Informe um nome", "error");
    try {
      const resp = await api.post("/tenant/api-keys", { nome });
      resultEl.innerHTML = `
        <div style="background:#FFF4E0; border:1px solid #D9A441; border-radius:8px; padding:14px;">
          <strong style="font-size:13px;">Copie agora — essa chave só aparece uma vez:</strong>
          <div style="font-family:monospace; font-size:13px; margin-top:8px; word-break:break-all; user-select:all;">${resp.chave}</div>
        </div>`;
      container.querySelector("#nome").value = "";
      load();
    } catch (err) { toast(err.message, "error"); }
  });

  load();
  return null;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
