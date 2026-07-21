import { api } from "../api.js";
import { toast } from "../toast.js";
import { getSession } from "../session.js";
import { onRealtime } from "../socket.js";

const CANAL_LABEL = { webchat: "💬 Webchat", whatsapp: "📱 WhatsApp", sms: "✉️ SMS", rcs: "🟢 RCS" };
const TABS = [
  { key: "aberta", label: "Abertas" },
  { key: "em_atendimento", label: "Em atendimento" },
  { key: "fechada", label: "Fechadas" },
];

export function renderInbox(container) {
  container.innerHTML = `
    <div class="inbox">
      <div class="inbox-list">
        <div class="inbox-list-header"><h1 style="margin:0;">Conversas</h1></div>
        <div class="inbox-tabs" id="inbox-tabs">
          ${TABS.map((t, i) => `<div class="inbox-tab${i === 0 ? " active" : ""}" data-status="${t.key}">${t.label}</div>`).join("")}
        </div>
        <div id="conv-list"><div class="empty-state">Carregando...</div></div>
      </div>
      <div class="thread" id="thread">
        <div class="empty-state" style="margin-top: 100px;">Selecione uma conversa para ver o histórico.</div>
      </div>
    </div>
  `;

  const session = getSession();
  const listEl = container.querySelector("#conv-list");
  const threadEl = container.querySelector("#thread");
  const tabsEl = container.querySelector("#inbox-tabs");

  let conversations = [];
  let selectedId = null;
  let currentStatus = "aberta";

  async function loadList() {
    listEl.innerHTML = `<div class="empty-state">Carregando...</div>`;
    try {
      conversations = await api.get(`/conversations?status=${currentStatus}`);
      renderList();
    } catch {
      listEl.innerHTML = `<div class="empty-state">Não foi possível carregar as conversas.</div>`;
    }
  }

  function renderList() {
    if (!conversations.length) {
      listEl.innerHTML = `<div class="empty-state">Nenhuma conversa por aqui.</div>`;
      return;
    }
    listEl.innerHTML = conversations
      .map((c) => {
        const nome = c.contato_nome || c.contato || "Contato";
        const hora = new Date(c.aberta_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        return `
        <div class="conv-item${c.id === selectedId ? " selected" : ""}" data-id="${c.id}">
          <div class="conv-item-top">
            <span class="conv-item-name">${escapeHtml(nome)}</span>
            <span class="conv-item-time">${hora}</span>
          </div>
          <div class="conv-item-preview">${escapeHtml(c.ultima_mensagem || "Sem mensagens ainda")}</div>
          <div class="conv-item-tags">
            <span class="tag canal">${CANAL_LABEL[c.canal] ?? c.canal}</span>
            ${c.departamento ? `<span class="tag">${escapeHtml(c.departamento)}</span>` : ""}
            ${c.atribuido_nome ? `<span class="tag agente">${escapeHtml(c.atribuido_nome)}</span>` : ""}
          </div>
        </div>`;
      })
      .join("");

    listEl.querySelectorAll(".conv-item").forEach((el) => {
      el.addEventListener("click", () => selectConversation(el.dataset.id));
    });
  }

  async function selectConversation(id) {
    selectedId = id;
    renderList();
    threadEl.innerHTML = `<div class="empty-state" style="margin-top: 100px;">Carregando conversa...</div>`;

    const conv = conversations.find((c) => c.id === id);
    const messages = await api.get(`/conversations/${id}/messages`);

    threadEl.innerHTML = `
      <div class="thread-header">
        <div>
          <div class="thread-header-title">${escapeHtml(conv?.contato_nome || conv?.contato || "Contato")}</div>
          <div class="thread-header-sub">
            ${CANAL_LABEL[conv?.canal] ?? conv?.canal} · ${escapeHtml(conv?.departamento || "sem departamento")}
            ${conv?.atribuido_nome ? ` · atendido por ${escapeHtml(conv.atribuido_nome)}` : ""}
          </div>
        </div>
        <div class="thread-actions">
          <button class="btn secondary btn-sm" id="assign-me-btn">Atribuir a mim</button>
          <button class="btn danger btn-sm" id="close-conv-btn">Encerrar</button>
        </div>
      </div>
      <div class="thread-messages" id="thread-messages">
        ${messages.map(renderBubble).join("")}
      </div>
      <div class="thread-input">
        <input type="text" id="reply-input" placeholder="Digite sua resposta..." ${conv?.status === "fechada" ? "disabled" : ""} />
        <button class="btn" id="reply-btn" ${conv?.status === "fechada" ? "disabled" : ""}>Enviar</button>
      </div>
    `;
    scrollThreadToBottom();

    threadEl.querySelector("#assign-me-btn").addEventListener("click", async () => {
      try {
        await api.patch(`/conversations/${id}/assign`, { agenteId: session.user.userId });
        toast("Conversa atribuída a você");
      } catch (err) {
        toast(err.message, "error");
      }
    });

    threadEl.querySelector("#close-conv-btn").addEventListener("click", async () => {
      try {
        await api.patch(`/conversations/${id}/close`, {});
        toast("Conversa encerrada");
      } catch (err) {
        toast(err.message, "error");
      }
    });

    const sendReply = async () => {
      const input = threadEl.querySelector("#reply-input");
      const texto = input.value.trim();
      if (!texto) return;
      input.value = "";
      try {
        await api.post(`/conversations/${id}/reply`, { texto });
      } catch (err) {
        toast(err.message, "error");
      }
    };
    threadEl.querySelector("#reply-btn").addEventListener("click", sendReply);
    threadEl.querySelector("#reply-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendReply();
    });
  }

  function renderBubble(m) {
    const hora = new Date(m.enviado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `
      <div class="bubble ${m.remetente_tipo}">
        ${escapeHtml(m.conteudo)}
        <div class="bubble-meta">${hora}</div>
      </div>`;
  }

  function scrollThreadToBottom() {
    const el = threadEl.querySelector("#thread-messages");
    if (el) el.scrollTop = el.scrollHeight;
  }

  tabsEl.querySelectorAll(".inbox-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      tabsEl.querySelectorAll(".inbox-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentStatus = tab.dataset.status;
      selectedId = null;
      threadEl.innerHTML = `<div class="empty-state" style="margin-top: 100px;">Selecione uma conversa para ver o histórico.</div>`;
      loadList();
    });
  });

  // ---- tempo real: é aqui que o "múltiplos agentes atendendo" acontece ----
  const unsubMessage = onRealtime("message:new", (payload) => {
    if (payload.conversationId === selectedId) {
      const msgsEl = threadEl.querySelector("#thread-messages");
      if (msgsEl) {
        msgsEl.insertAdjacentHTML("beforeend", renderBubble(payload.message));
        scrollThreadToBottom();
      }
    }
    // Atualiza a prévia na lista sem precisar recarregar tudo.
    const conv = conversations.find((c) => c.id === payload.conversationId);
    if (conv) {
      conv.ultima_mensagem = payload.message.conteudo;
      renderList();
    } else if (currentStatus === "aberta") {
      loadList(); // conversa nova entrou — só recarrega se estamos vendo "Abertas"
    }
  });

  const unsubConvUpdate = onRealtime("conversation:updated", (updated) => {
    const idx = conversations.findIndex((c) => c.id === updated.id);
    if (idx >= 0) {
      if (updated.status !== currentStatus) {
        conversations.splice(idx, 1); // saiu da aba atual (ex.: foi encerrada)
      }
    }
    if (updated.id === selectedId) {
      loadList().then(() => selectConversation(selectedId));
    } else {
      loadList();
    }
  });

  loadList();

  return () => {
    unsubMessage();
    unsubConvUpdate();
  };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
