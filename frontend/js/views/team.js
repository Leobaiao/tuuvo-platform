import { api } from "../api.js";
import { toast } from "../toast.js";

export function renderTeam(container) {
  container.innerHTML = `
    <div class="page-pad">
      <h1>Equipe</h1>
      <p class="subtitle">Múltiplos agentes podem atender em paralelo — cada um vê as conversas em tempo real.</p>
      <div class="card" style="margin-bottom: 20px;">
        <div id="team-list"><div class="empty-state">Carregando...</div></div>
      </div>

      <div class="card card-pad">
        <div class="toolbar" style="margin-bottom: 12px;"><strong>Convidar agente</strong></div>
        <div class="row2">
          <div class="field">
            <label>Nome</label>
            <input type="text" id="team-nome" />
          </div>
          <div class="field">
            <label>E-mail</label>
            <input type="email" id="team-email" />
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label>Senha provisória</label>
            <input type="text" id="team-senha" placeholder="mínimo 8 caracteres" />
          </div>
          <div class="field">
            <label>Papel</label>
            <select id="team-papel">
              <option value="agente">Agente</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <button class="btn" id="team-invite-btn">Convidar</button>
      </div>
    </div>
  `;

  const listEl = container.querySelector("#team-list");

  async function load() {
    try {
      const team = await api.get("/tenant/team");
      listEl.innerHTML = team
        .map(
          (u) => `
        <div class="list-item">
          <div>
            <div class="list-item-title">${escapeHtml(u.nome ?? u.email)}</div>
            <div class="list-item-sub">${escapeHtml(u.email)}</div>
          </div>
          <span class="badge neutro">${u.papel}</span>
        </div>`
        )
        .join("");
    } catch {
      listEl.innerHTML = `<div class="empty-state">Não foi possível carregar a equipe.</div>`;
    }
  }

  container.querySelector("#team-invite-btn").addEventListener("click", async () => {
    const nome = container.querySelector("#team-nome").value.trim();
    const email = container.querySelector("#team-email").value.trim();
    const senhaProvisoria = container.querySelector("#team-senha").value;
    const papel = container.querySelector("#team-papel").value;

    if (!nome || !email || senhaProvisoria.length < 8) {
      return toast("Preencha nome, e-mail e uma senha com 8+ caracteres", "error");
    }
    try {
      await api.post("/tenant/team", { nome, email, senhaProvisoria, papel });
      toast("Agente convidado");
      container.querySelector("#team-nome").value = "";
      container.querySelector("#team-email").value = "";
      container.querySelector("#team-senha").value = "";
      load();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  load();
  return null;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
