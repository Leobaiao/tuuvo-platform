import { api } from "../api.js";
import { toast } from "../toast.js";

export function renderTenants(container) {
  container.innerHTML = `
    <div class="page-pad">
      <h1>Tenants</h1>
      <p class="subtitle">Clientes da plataforma — vindos de onboarding ou cadastrados manualmente.</p>

      <div class="card" style="margin-bottom:20px;">
        <div class="toolbar" style="padding:20px 20px 0;">
          <div></div>
          <button class="btn btn-sm" id="new-tenant-btn">+ Novo tenant</button>
        </div>
        <div id="tenant-list"><div class="empty-state">Carregando...</div></div>
      </div>

      <div id="new-tenant-form" hidden class="card card-pad">
        <div class="row2">
          <div class="field"><label>Nome da empresa</label><input type="text" id="t-nome" /></div>
          <div class="field"><label>Slug (usado em URL)</label><input type="text" id="t-slug" placeholder="loja-exemplo" /></div>
        </div>
        <div class="row2">
          <div class="field"><label>E-mail do admin</label><input type="email" id="t-email" /></div>
          <div class="field"><label>Senha provisória</label><input type="text" id="t-senha" placeholder="mínimo 8 caracteres" /></div>
        </div>
        <button class="btn" id="t-save-btn">Criar tenant</button>
        <button class="btn secondary" id="t-cancel-btn">Cancelar</button>
      </div>
    </div>
  `;

  const listEl = container.querySelector("#tenant-list");
  const formEl = container.querySelector("#new-tenant-form");

  async function load() {
    try {
      const tenants = await api.get("/tuuvo/tenants");
      if (!tenants.length) { listEl.innerHTML = `<div class="empty-state">Nenhum tenant ainda.</div>`; return; }
      listEl.innerHTML = tenants.map((t) => `
        <div class="list-row" style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px; border-bottom:1px solid var(--border);">
          <div>
            <strong>${escapeHtml(t.nome)}</strong>
            <div style="font-size:12px; color:var(--cinza-texto);">${t.slug} · origem: ${t.origem}${t.avaliacao_adiada_ate ? ` · avaliação adiada até ${new Date(t.avaliacao_adiada_ate).toLocaleDateString("pt-BR")}` : ""}</div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="badge ${t.status}">${t.status}</span>
            <select class="status-select" data-id="${t.id}" style="font-size:12px; padding:4px 8px; border-radius:6px; border:1px solid var(--border);">
              <option value="avaliacao" ${t.status === "avaliacao" ? "selected" : ""}>avaliação</option>
              <option value="ativo" ${t.status === "ativo" ? "selected" : ""}>ativo</option>
              <option value="suspenso" ${t.status === "suspenso" ? "selected" : ""}>suspenso</option>
              <option value="cancelado" ${t.status === "cancelado" ? "selected" : ""}>cancelado</option>
            </select>
            <button class="btn secondary btn-sm adiar-btn" data-id="${t.id}">Adiar avaliação</button>
          </div>
        </div>`).join("");

      listEl.querySelectorAll(".status-select").forEach((sel) => {
        sel.addEventListener("change", async () => {
          try {
            await api.patch(`/tuuvo/tenants/${sel.dataset.id}/status`, { status: sel.value });
            toast("Status atualizado");
            load();
          } catch (err) { toast(err.message, "error"); }
        });
      });
      listEl.querySelectorAll(".adiar-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const dias = prompt("Adiar avaliação por quantos dias?", "7");
          if (!dias) return;
          const ate = new Date(Date.now() + Number(dias) * 86400000).toISOString();
          try {
            await api.patch(`/tuuvo/tenants/${btn.dataset.id}/adiar-avaliacao`, { ate });
            toast("Avaliação adiada");
            load();
          } catch (err) { toast(err.message, "error"); }
        });
      });
    } catch { listEl.innerHTML = `<div class="empty-state">Não foi possível carregar os tenants.</div>`; }
  }

  container.querySelector("#new-tenant-btn").addEventListener("click", () => { formEl.hidden = false; });
  container.querySelector("#t-cancel-btn").addEventListener("click", () => { formEl.hidden = true; });
  container.querySelector("#t-save-btn").addEventListener("click", async () => {
    const nome = container.querySelector("#t-nome").value.trim();
    const slug = container.querySelector("#t-slug").value.trim();
    const adminEmail = container.querySelector("#t-email").value.trim();
    const adminSenha = container.querySelector("#t-senha").value;
    if (!nome || !slug || !adminEmail || adminSenha.length < 8) return toast("Preencha tudo (senha com 8+ caracteres)", "error");
    try {
      await api.post("/tuuvo/tenants", { nome, slug, adminEmail, adminSenha, origem: "manual" });
      toast("Tenant criado");
      formEl.hidden = true;
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
