import { api } from "../api.js";
import { toast } from "../toast.js";
import { getSession } from "../session.js";
import { onRealtime } from "../socket.js";
import { config } from "../config.js";

const CANAL_LABEL = {
  webchat: "💬 Webchat", whatsapp_gti: "📱 WhatsApp", whatsapp_zernio: "✅ WhatsApp",
  zernio_instagram: "📸 Instagram", zernio_telegram: "✈️ Telegram", rcs: "🟢 RCS", email: "✉️ E-mail",
};
const TABS = [
  { key: "aberta", label: "Abertas" },
  { key: "em_atendimento", label: "Em atendimento" },
  { key: "fechada", label: "Fechadas" },
];

export function renderInbox(container) {
  container.innerHTML = `
    <div class="inbox">
      <div class="inbox-list">
        <div style="padding:20px 20px 12px;"><h1 style="margin:0;">Conversas</h1></div>
        <div class="inbox-tabs">
          ${TABS.map((t, i) => `<div class="inbox-tab${i === 0 ? " active" : ""}" data-status="${t.key}">${t.label}</div>`).join("")}
        </div>
        <div id="conv-list"><div class="empty-state">Carregando...</div></div>
      </div>
      <div class="thread" id="thread"><div class="empty-state" style="margin-top:100px;">Selecione uma conversa.</div></div>
    </div>
  `;

  const session = getSession();
  const listEl = container.querySelector("#conv-list");
  const threadEl = container.querySelector("#thread");
  const tabsEl = container.querySelector(".inbox-tabs");

  let conversations = [];
  let equipes = [];
  let selectedId = null;
  let currentStatus = "aberta";

  api.get("/tenant/equipes").then((rows) => { equipes = rows; });

  async function loadList() {
    listEl.innerHTML = `<div class="empty-state">Carregando...</div>`;
    try {
      conversations = await api.get(`/conversations?status=${currentStatus}`);
      renderList();
    } catch { listEl.innerHTML = `<div class="empty-state">Não foi possível carregar.</div>`; }
  }

  function renderList() {
    if (!conversations.length) { listEl.innerHTML = `<div class="empty-state">Nenhuma conversa por aqui.</div>`; return; }
    listEl.innerHTML = conversations.map((c) => {
      const nome = c.contato_nome || c.contato || "Contato";
      const hora = new Date(c.aberta_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      return `
        <div class="conv-item${c.id === selectedId ? " selected" : ""}" data-id="${c.id}">
          <div class="conv-item-top"><span class="conv-item-name">${escapeHtml(nome)}</span><span class="conv-item-time">${hora}</span></div>
          <div class="conv-item-preview">${escapeHtml(c.ultima_mensagem || "Sem mensagens ainda")}</div>
          <div class="conv-item-tags">
            <span class="tag canal">${CANAL_LABEL[c.canal] ?? c.canal}</span>
            ${c.equipe ? `<span class="tag">${escapeHtml(c.equipe)}</span>` : ""}
            ${c.contato_tipo === "interno" ? `<span class="tag">interno</span>` : ""}
            ${c.atribuido_nome ? `<span class="tag agente">${escapeHtml(c.atribuido_nome)}</span>` : ""}
          </div>
        </div>`;
    }).join("");
    listEl.querySelectorAll(".conv-item").forEach((el) => el.addEventListener("click", () => selectConversation(el.dataset.id)));
  }

  async function selectConversation(id) {
    selectedId = id;
    renderList();
    threadEl.innerHTML = `<div class="empty-state" style="margin-top:100px;">Carregando...</div>`;

    const conv = conversations.find((c) => c.id === id);
    const messages = await api.get(`/conversations/${id}/messages?incluirNotas=true`);

    threadEl.innerHTML = `
      <div class="thread-header">
        <div>
          <div class="thread-header-title">${escapeHtml(conv?.contato_nome || conv?.contato || "Contato")}</div>
          <div class="thread-header-sub">
            ${CANAL_LABEL[conv?.canal] ?? conv?.canal ?? ""} · ${escapeHtml(conv?.equipe || "sem equipe")}
            ${conv?.atribuido_nome ? ` · atendido por ${escapeHtml(conv.atribuido_nome)}` : ""}
          </div>
        </div>
        <div class="thread-actions">
          <button class="btn secondary btn-sm" id="assign-btn">Atribuir a mim</button>
          <button class="btn secondary btn-sm" id="transfer-btn">Transferir</button>
          <button class="btn secondary btn-sm" id="note-btn">Nota interna</button>
          <button class="btn secondary btn-sm" id="export-btn">Exportar</button>
          <button class="btn danger btn-sm" id="close-btn">Encerrar</button>
        </div>
      </div>
      <div id="transfer-panel" hidden style="padding:14px 24px; border-bottom:1px solid var(--border); background:var(--bg);">
        <div class="row2">
          <div class="field"><label>Nova equipe</label>
            <select id="transfer-equipe"><option value="">(manter)</option>${equipes.map((e) => `<option value="${e.id}">${escapeHtml(e.nome)}</option>`).join("")}</select>
          </div>
          <div class="field" style="display:flex; align-items:flex-end; gap:8px;">
            <button class="btn btn-sm" id="transfer-confirm-btn">Confirmar transferência</button>
          </div>
        </div>
      </div>
      <div id="note-panel" hidden style="padding:14px 24px; border-bottom:1px solid var(--border); background:#FFF4E0;">
        <div class="field"><label>Nota interna (o solicitante não vê)</label><textarea id="note-text" rows="2"></textarea></div>
        <button class="btn btn-sm" id="note-confirm-btn">Adicionar nota</button>
      </div>
      <div class="thread-messages" id="thread-messages">${messages.map(renderBubble).join("")}</div>
      <div class="thread-input">
        <input type="text" id="reply-input" placeholder="Digite sua resposta..." ${conv?.status === "fechada" ? "disabled" : ""} />
        <button class="btn" id="reply-btn" ${conv?.status === "fechada" ? "disabled" : ""}>Enviar</button>
      </div>
    `;
    scrollToBottom();

    threadEl.querySelector("#assign-btn").addEventListener("click", async () => {
      try {
        await api.post(`/conversations/${id}/transferir`, { paraAgenteId: session.user.userId, paraEquipeId: null });
        toast("Conversa atribuída a você");
      } catch (err) { toast(err.message, "error"); }
    });

    threadEl.querySelector("#transfer-btn").addEventListener("click", () => {
      threadEl.querySelector("#transfer-panel").hidden = false;
    });
    threadEl.querySelector("#transfer-confirm-btn").addEventListener("click", async () => {
      const paraEquipeId = threadEl.querySelector("#transfer-equipe").value || null;
      try {
        await api.post(`/conversations/${id}/transferir`, { paraEquipeId, paraAgenteId: null });
        toast("Conversa transferida");
        threadEl.querySelector("#transfer-panel").hidden = true;
      } catch (err) { toast(err.message, "error"); }
    });

    threadEl.querySelector("#note-btn").addEventListener("click", () => {
      threadEl.querySelector("#note-panel").hidden = false;
    });
    threadEl.querySelector("#note-confirm-btn").addEventListener("click", async () => {
      const texto = threadEl.querySelector("#note-text").value.trim();
      if (!texto) return;
      try {
        await api.post(`/conversations/${id}/nota-interna`, { texto });
        threadEl.querySelector("#note-panel").hidden = true;
        threadEl.querySelector("#note-text").value = "";
      } catch (err) { toast(err.message, "error"); }
    });

    threadEl.querySelector("#export-btn").addEventListener("click", () => {
      downloadExport(id);
    });

    threadEl.querySelector("#close-btn").addEventListener("click", async () => {
      try { await api.patch(`/conversations/${id}/close`, {}); toast("Conversa encerrada"); }
      catch (err) { toast(err.message, "error"); }
    });

    const sendReply = async () => {
      const input = threadEl.querySelector("#reply-input");
      const texto = input.value.trim();
      if (!texto) return;
      input.value = "";
      try { await api.post(`/conversations/${id}/reply`, { texto }); }
      catch (err) { toast(err.message, "error"); }
    };
    threadEl.querySelector("#reply-btn").addEventListener("click", sendReply);
    threadEl.querySelector("#reply-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendReply(); });
  }

  async function downloadExport(id) {
    try {
      const session2 = getSession();
      const resp = await fetch(`${config.backendUrl}/conversations/${id}/export`, {
        headers: { Authorization: `Bearer ${session2.token}` },
      });
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `conversa-${id}.txt`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { toast("Erro ao exportar: " + err.message, "error"); }
  }

  function renderBubble(m) {
    const hora = new Date(m.enviado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const classe = m.tipo === "nota_interna" ? "nota-interna" : m.remetente_tipo;
    const prefixo = m.tipo === "nota_interna" ? "📌 " : "";
    return `<div class="bubble ${classe}">${prefixo}${escapeHtml(m.conteudo)}<div class="bubble-meta">${hora}</div></div>`;
  }

  function scrollToBottom() {
    const el = threadEl.querySelector("#thread-messages");
    if (el) el.scrollTop = el.scrollHeight;
  }

  tabsEl.querySelectorAll(".inbox-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      tabsEl.querySelectorAll(".inbox-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentStatus = tab.dataset.status;
      selectedId = null;
      threadEl.innerHTML = `<div class="empty-state" style="margin-top:100px;">Selecione uma conversa.</div>`;
      loadList();
    });
  });

  const unsubMessage = onRealtime("message:new", (payload) => {
    if (payload.conversationId === selectedId) {
      const msgsEl = threadEl.querySelector("#thread-messages");
      if (msgsEl) { msgsEl.insertAdjacentHTML("beforeend", renderBubble(payload.message)); scrollToBottom(); }
    }
    const conv = conversations.find((c) => c.id === payload.conversationId);
    if (conv && payload.message.visivel_pro_solicitante) { conv.ultima_mensagem = payload.message.conteudo; renderList(); }
    else if (!conv && currentStatus === "aberta") { loadList(); }
  });

  const unsubConv = onRealtime("conversation:updated", () => { loadList(); });

  loadList();
  return () => { unsubMessage(); unsubConv(); };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
