import { api } from "../api.js";
import { toast } from "../toast.js";

export function renderUsuarios(container) {
  container.innerHTML = `
    <div class="page-pad">
      <h1>Usuários</h1>
      <p class="subtitle">Atendentes com equipe e papel — vários agentes podem atender em paralelo, cada um vê em tempo real.</p>
      <div class="card" style="margin-bottom:20px;"><div id="list"></div></div>
      <div class="card card-pad">
        <strong>Convidar</strong>
        <div class="row2" style="margin-top:12px;">
          <div class="field"><label>Nome</label><input type="text" id="nome" /></div>
          <div class="field"><label>E-mail</label><input type="email" id="email" /></div>
        </div>
        <div class="row3">
          <div class="field"><label>Senha provisória</label><input type="text" id="senha" /></div>
          <div class="field"><label>Papel</label><select id="papel"><option value="agente">Agente</option><option value="supervisor">Supervisor</option><option value="admin">Admin</option></select></div>
          <div class="field"><label>Equipe</label><select id="equipe"><option value="">Sem equipe</option></select></div>
        </div>
        <button class="btn" id="save-btn">Convidar</button>
      </div>
    </div>
  `;

  const listEl = container.querySelector("#list");
  const equipeSel = container.querySelector("#equipe");

  async function load() {
    const [users, equipes] = await Promise.all([api.get("/tenant/usuarios"), api.get("/tenant/equipes")]);
    listEl.innerHTML = users.map((u) => `
      <div style="display:flex; justify-content:space-between; padding:14px 20px; border-bottom:1px solid var(--border);">
        <div><strong>${escapeHtml(u.nome ?? u.email)}</strong><div style="font-size:12px; color:var(--cinza-texto);">${escapeHtml(u.email)}</div></div>
        <span class="badge operador">${u.papel}</span>
      </div>`).join("");
    equipeSel.innerHTML = `<option value="">Sem equipe</option>` + equipes.map((e) => `<option value="${e.id}">${escapeHtml(e.nome)}</option>`).join("");
  }

  container.querySelector("#save-btn").addEventListener("click", async () => {
    const nome = container.querySelector("#nome").value.trim();
    const email = container.querySelector("#email").value.trim();
    const senhaProvisoria = container.querySelector("#senha").value;
    const papel = container.querySelector("#papel").value;
    const equipeId = equipeSel.value || null;
    if (!nome || !email || senhaProvisoria.length < 8) return toast("Preencha tudo (senha com 8+ caracteres)", "error");
    try {
      await api.post("/tenant/usuarios", { nome, email, senhaProvisoria, papel, equipeId });
      toast("Usuário convidado");
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
