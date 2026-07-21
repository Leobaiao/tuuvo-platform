import { api } from "../api.js";
import { toast } from "../toast.js";

export function renderDepartments(container) {
  container.innerHTML = `
    <div class="page-pad">
      <h1>Departamentos</h1>
      <p class="subtitle">Vivem dentro da conexão — uma única instância de WhatsApp pode atender vários setores.</p>
      <div class="card">
        <div class="toolbar" style="padding: 20px 20px 0;">
          <div></div>
          <button class="btn btn-sm" id="new-dept-btn">+ Novo departamento</button>
        </div>
        <div id="dept-list"><div class="empty-state">Carregando...</div></div>
      </div>

      <div id="new-dept-form" hidden style="margin-top: 20px;" class="card card-pad">
        <div class="field">
          <label>Nome do departamento</label>
          <input type="text" id="dept-nome" placeholder="Ex.: Suporte" />
        </div>
        <button class="btn" id="dept-save-btn">Criar departamento</button>
        <button class="btn secondary" id="dept-cancel-btn">Cancelar</button>
      </div>
    </div>
  `;

  const listEl = container.querySelector("#dept-list");
  const formEl = container.querySelector("#new-dept-form");

  async function load() {
    try {
      const depts = await api.get("/tenant/departments");
      if (!depts.length) {
        listEl.innerHTML = `<div class="empty-state">Nenhum departamento ainda. Crie o primeiro para organizar o atendimento.</div>`;
        return;
      }
      listEl.innerHTML = depts
        .map(
          (d) => `
        <div class="list-item">
          <div>
            <div class="list-item-title">${escapeHtml(d.nome)}</div>
            <div class="list-item-sub">Criado em ${new Date(d.criado_em).toLocaleDateString("pt-BR")}</div>
          </div>
        </div>`
        )
        .join("");
    } catch {
      listEl.innerHTML = `<div class="empty-state">Não foi possível carregar os departamentos.</div>`;
    }
  }

  container.querySelector("#new-dept-btn").addEventListener("click", () => {
    formEl.hidden = false;
  });
  container.querySelector("#dept-cancel-btn").addEventListener("click", () => {
    formEl.hidden = true;
  });
  container.querySelector("#dept-save-btn").addEventListener("click", async () => {
    const nome = container.querySelector("#dept-nome").value.trim();
    if (!nome) return toast("Informe um nome", "error");
    try {
      await api.post("/tenant/departments", { nome });
      toast("Departamento criado");
      formEl.hidden = true;
      container.querySelector("#dept-nome").value = "";
      load();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  load();
  return null; // sem listeners de socket pra limpar nesta view
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
