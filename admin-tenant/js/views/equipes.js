import { api } from "../api.js";
import { toast } from "../toast.js";

export function renderEquipes(container) {
  container.innerHTML = `
    <div class="page-pad">
      <h1>Equipes</h1>
      <p class="subtitle">Roteamento de canal e agrupamento de atendentes — era "departamento" na versão anterior.</p>
      <div class="card">
        <div class="toolbar" style="padding:20px 20px 0;">
          <div></div>
          <button class="btn btn-sm" id="new-btn">+ Nova equipe</button>
        </div>
        <div id="list"><div class="empty-state">Carregando...</div></div>
      </div>
      <div id="form" hidden style="margin-top:20px;" class="card card-pad">
        <div class="field"><label>Nome</label><input type="text" id="nome" placeholder="Ex.: Suporte" /></div>
        <button class="btn" id="save-btn">Criar</button>
        <button class="btn secondary" id="cancel-btn">Cancelar</button>
      </div>
    </div>
  `;

  const listEl = container.querySelector("#list");
  const formEl = container.querySelector("#form");

  async function load() {
    const rows = await api.get("/tenant/equipes");
    listEl.innerHTML = rows.length
      ? rows.map((e) => `<div style="padding:14px 20px; border-bottom:1px solid var(--border);"><strong>${escapeHtml(e.nome)}</strong></div>`).join("")
      : `<div class="empty-state">Nenhuma equipe ainda.</div>`;
  }

  container.querySelector("#new-btn").addEventListener("click", () => { formEl.hidden = false; });
  container.querySelector("#cancel-btn").addEventListener("click", () => { formEl.hidden = true; });
  container.querySelector("#save-btn").addEventListener("click", async () => {
    const nome = container.querySelector("#nome").value.trim();
    if (!nome) return toast("Informe um nome", "error");
    try {
      await api.post("/tenant/equipes", { nome });
      toast("Equipe criada");
      formEl.hidden = true;
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
