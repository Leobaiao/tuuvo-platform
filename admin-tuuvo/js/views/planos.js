import { api } from "../api.js";
import { toast } from "../toast.js";

export function renderPlanos(container) {
  container.innerHTML = `
    <div class="page-pad">
      <h1>Planos de preço</h1>
      <p class="subtitle">Alimenta o site público via <code>tuuvo-pricing.js</code> — mudar aqui já atualiza o site, sem novo deploy.</p>
      <div id="planos-list"></div>
      <div class="card card-pad" style="margin-top:20px;">
        <strong>Novo plano</strong>
        <div class="row3" style="margin-top:12px;">
          <div class="field"><label>Nome</label><input type="text" id="p-nome" /></div>
          <div class="field"><label>Preço (R$, vazio = "sob consulta")</label><input type="number" id="p-preco" /></div>
          <div class="field"><label>Ordem de exibição</label><input type="number" id="p-ordem" value="0" /></div>
        </div>
        <div class="field"><label>Descrição curta</label><input type="text" id="p-desc" /></div>
        <div class="field"><label>Features (uma por linha)</label><textarea id="p-features" rows="4"></textarea></div>
        <label style="display:flex; align-items:center; gap:8px; font-size:14px; margin-bottom:16px;">
          <input type="checkbox" id="p-destaque" /> Marcar como "mais escolhido"
        </label>
        <button class="btn" id="p-save-btn">Criar plano</button>
      </div>
    </div>
  `;

  const listEl = container.querySelector("#planos-list");

  async function load() {
    const planos = await api.get("/tuuvo/planos");
    listEl.innerHTML = planos.map((p) => `
      <div class="card card-pad" style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong>${escapeHtml(p.nome)}</strong> ${p.destaque ? '<span class="badge ativo">mais escolhido</span>' : ""}
          <div style="font-size:13px; color:var(--cinza-texto); margin-top:4px;">
            ${p.preco != null ? `R$ ${p.preco}${p.preco_sufixo}` : "Sob consulta"} · ${(p.features || []).length} features
          </div>
        </div>
        <label style="display:flex; align-items:center; gap:8px; font-size:13px;">
          <input type="checkbox" class="ativo-toggle" data-id="${p.id}" ${p.ativo ? "checked" : ""} /> Ativo no site
        </label>
      </div>
    `).join("");

    listEl.querySelectorAll(".ativo-toggle").forEach((cb) => {
      cb.addEventListener("change", async () => {
        try {
          await api.patch(`/tuuvo/planos/${cb.dataset.id}/ativo`, { ativo: cb.checked });
          toast("Plano atualizado");
        } catch (err) { toast(err.message, "error"); }
      });
    });
  }

  container.querySelector("#p-save-btn").addEventListener("click", async () => {
    const nome = container.querySelector("#p-nome").value.trim();
    const precoRaw = container.querySelector("#p-preco").value;
    const descricao = container.querySelector("#p-desc").value.trim();
    const features = container.querySelector("#p-features").value.split("\n").map((f) => f.trim()).filter(Boolean);
    const destaque = container.querySelector("#p-destaque").checked;
    const ordemExibicao = Number(container.querySelector("#p-ordem").value) || 0;
    if (!nome) return toast("Informe um nome", "error");
    try {
      await api.post("/tuuvo/planos", {
        nome, preco: precoRaw ? Number(precoRaw) : null, descricao, features, destaque, ordemExibicao,
      });
      toast("Plano criado");
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
