/**
 * TUUVO Widget SDK — script único que o tenant cola no próprio site pra
 * aplicar o canal de webchat em qualquer aplicação externa (a peça que
 * faltava explicitar, arquitetura v2, seção 9 "Uso em aplicações externas").
 *
 * Uso no site do tenant:
 *   <script src="https://SEU-BACKEND/tuuvo-widget.js"
 *     data-tenant="ID_DO_TENANT" data-widget="ID_DO_WIDGET"
 *     data-backend="https://SEU-BACKEND"></script>
 *
 * Não depende de framework nenhum do lado do tenant — vanilla JS, sem
 * build step, funciona em qualquer site (WordPress, React, HTML estático,
 * o que for).
 */
(function () {
  const scriptTag = document.currentScript;
  const tenantId = scriptTag.dataset.tenant;
  const widgetId = scriptTag.dataset.widget;
  const backendUrl = scriptTag.dataset.backend || "";

  if (!tenantId || !widgetId) {
    console.error("[TUUVO Widget] data-tenant e data-widget são obrigatórios no <script>.");
    return;
  }

  const DEFAULTS = {
    corPrimaria: "#6A38E2", corFundo: "#FFFFFF", corTexto: "#1A143D",
    mensagemBoasVindas: "Olá! Como podemos ajudar?", posicao: "bottom-right",
    somNotificacao: true, autoOpen: false, autoOpenDelaySegundos: 5,
  };

  let cfg = { ...DEFAULTS };
  let aberto = false;
  let socket = null;
  // Persistido no localStorage — sem isso, cada F5 na página criava um
  // "visitante" novo pro backend (contato novo, conversa nova, histórico
  // perdido). Com isso, a mesma pessoa mantém a mesma conversa ao recarregar.
  const visitorId = (function () {
    const chave = "tuuvo_visitor_id";
    let id = null;
    try { id = localStorage.getItem(chave); } catch {}
    if (!id) {
      id = "visitor-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { localStorage.setItem(chave, id); } catch {}
    }
    return id;
  })();

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #tuuvo-bubble { position: fixed; ${cfg.posicao === "bottom-left" ? "left" : "right"}: 20px; bottom: 20px;
        width: 56px; height: 56px; border-radius: 50%; background: ${cfg.corPrimaria}; cursor: pointer;
        box-shadow: 0 8px 24px rgba(0,0,0,.25); z-index: 999999; display:flex; align-items:center; justify-content:center; }
      #tuuvo-bubble svg { width: 26px; height: 26px; fill: #fff; }
      #tuuvo-panel { position: fixed; ${cfg.posicao === "bottom-left" ? "left" : "right"}: 20px; bottom: 88px;
        width: 340px; height: 480px; background: ${cfg.corFundo}; border-radius: 16px; box-shadow: 0 16px 48px rgba(0,0,0,.25);
        display: none; flex-direction: column; overflow: hidden; z-index: 999999; font-family: Inter, Arial, sans-serif; }
      #tuuvo-panel.open { display: flex; }
      #tuuvo-header { background: ${cfg.corPrimaria}; color: #fff; padding: 14px 16px; font-weight: 700; }
      #tuuvo-messages { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
      .tuuvo-msg { max-width: 80%; padding: 8px 12px; border-radius: 12px; font-size: 13px; color: ${cfg.corTexto}; background: #F1F4F9; }
      .tuuvo-msg.self { align-self: flex-end; background: ${cfg.corPrimaria}; color: #fff; }
      #tuuvo-input-row { display:flex; gap:8px; padding:10px; border-top:1px solid #eee; }
      #tuuvo-input-row input { flex:1; border:1px solid #ddd; border-radius:8px; padding:8px 10px; font-size:13px; }
      #tuuvo-input-row button { background:${cfg.corPrimaria}; color:#fff; border:none; border-radius:8px; padding:0 14px; }
    `;
    document.head.appendChild(style);
  }

  function render() {
    const bubble = document.createElement("div");
    bubble.id = "tuuvo-bubble";
    bubble.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>`;
    bubble.addEventListener("click", toggle);

    const panel = document.createElement("div");
    panel.id = "tuuvo-panel";
    panel.innerHTML = `
      <div id="tuuvo-header">${cfg.mensagemBoasVindas ? "" : ""}Fale conosco</div>
      <div id="tuuvo-messages"><div class="tuuvo-msg">${escapeHtml(cfg.mensagemBoasVindas)}</div></div>
      <div id="tuuvo-input-row">
        <input type="text" id="tuuvo-input" placeholder="Digite sua mensagem..." />
        <button id="tuuvo-send">Enviar</button>
      </div>`;

    document.body.appendChild(bubble);
    document.body.appendChild(panel);

    panel.querySelector("#tuuvo-send").addEventListener("click", sendMessage);
    panel.querySelector("#tuuvo-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });

    if (cfg.autoOpen) setTimeout(() => toggle(true), (cfg.autoOpenDelaySegundos || 5) * 1000);
  }

  function toggle(forceOpen) {
    aberto = forceOpen === true ? true : forceOpen === false ? false : !aberto;
    document.getElementById("tuuvo-panel").classList.toggle("open", aberto);
  }

  function sendMessage() {
    const input = document.getElementById("tuuvo-input");
    const texto = input.value.trim();
    if (!texto) return;
    appendMessage(texto, true);
    input.value = "";
    if (socket) socket.emit("webchat:message", { text: texto });
  }

  function appendMessage(texto, self) {
    const messagesEl = document.getElementById("tuuvo-messages");
    const div = document.createElement("div");
    div.className = "tuuvo-msg" + (self ? " self" : "");
    div.textContent = texto;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (cfg.somNotificacao && !self && !aberto) playNotificationSound();
  }

  function playNotificationSound() {
    // TODO: som real — deixado como placeholder silencioso pra não assumir
    // asset de áudio que não existe neste scaffold.
  }

  function connectRealtime() {
    if (typeof window.io !== "function") {
      console.warn("[TUUVO Widget] Socket.IO indisponível — widget funciona só com a mensagem de boas-vindas.");
      return;
    }
    socket = window.io(backendUrl, { auth: { tenantId, widgetId, visitorId } });
    socket.on("message:new", (payload) => {
      if (payload.message?.remetente_tipo === "agente" && payload.message?.visivel_pro_solicitante) {
        appendMessage(payload.message.conteudo, false);
      }
    });
  }

  async function init() {
    try {
      const res = await fetch(`${backendUrl}/tenant/widgets/public/${widgetId}`);
      if (res.ok) {
        const data = await res.json();
        cfg = { ...DEFAULTS, ...data.configJson };
      }
    } catch {
      console.warn("[TUUVO Widget] Não foi possível carregar a config publicada — usando padrão.");
    }
    injectStyles();
    render();
    connectRealtime();
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
