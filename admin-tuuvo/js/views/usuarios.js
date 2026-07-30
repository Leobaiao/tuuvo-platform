import { api } from "../api.js";
import { toast } from "../toast.js";

export function renderUsuarios(container) {
  container.innerHTML = `
    <div class="page-pad">
      <h1>Time TUUVO</h1>
      <p class="subtitle">Login separado do tenant — superadmin tem acesso total, operador é limitado.</p>
      <div id="users-list" class="card" style="margin-bottom:20px;"></div>
      <div class="card card-pad">
        <strong>Convidar</strong>
        <div class="row2" style="margin-top:12px;">
          <div class="field"><label>Nome</label><input type="text" id="u-nome" /></div>
          <div class="field"><label>E-mail</label><input type="email" id="u-email" /></div>
        </div>
        <div class="row2">
          <div class="field"><label>Senha provisória</label><input type="text" id="u-senha" /></div>
          <div class="field"><label>Papel</label><select id="u-papel"><option value="operador">Operador</option><option value="superadmin">Superadmin</option></select></div>
        </div>
        <button class="btn" id="u-save-btn">Convidar</button>
      </div>
    </div>
  `;

  const listEl = container.querySelector("#users-list");

  async function load() {
    const rows = await api.get("/tuuvo/usuarios");
    listEl.innerHTML = rows.map((u) => `
      <div style="display:flex; justify-content:space-between; padding:14px 20px; border-bottom:1px solid var(--border);">
        <div><strong>${escapeHtml(u.nome ?? u.email)}</strong><div style="font-size:12px; color:var(--cinza-texto);">${escapeHtml(u.email)}</div></div>
        <span class="badge ${u.papel}">${u.papel}</span>
      </div>`).join("");
  }

  container.querySelector("#u-save-btn").addEventListener("click", async () => {
    const nome = container.querySelector("#u-nome").value.trim();
    const email = container.querySelector("#u-email").value.trim();
    const senhaProvisoria = container.querySelector("#u-senha").value;
    const papel = container.querySelector("#u-papel").value;
    if (!nome || !email || senhaProvisoria.length < 8) return toast("Preencha tudo (senha com 8+ caracteres)", "error");
    try {
      await api.post("/tuuvo/usuarios", { nome, email, senhaProvisoria, papel });
      toast("Usuário convidado");
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
