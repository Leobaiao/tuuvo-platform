/**
 * TUUVO Webchat Widget — SDK de embed.
 *
 * Uso:
 *   <script src="https://cdn.tuuvo.app.br/widget.js"
 *           data-tenant="TENANT_ID"
 *           data-widget="WIDGET_ID"
 *           data-backend="https://api.tuuvo.app.br"
 *           data-socket="https://api.tuuvo.app.br"></script>
 *
 * Todas as propriedades visuais (cor, header, avatar, dimensões...) vêm de
 * `config.configJson`, publicado no Widget Builder (seção 8 da especificação).
 * Aqui aplicamos defaults na paleta TUUVO caso o tenant não sobrescreva.
 */
(function () {
  const DEFAULTS = {
    corPrimaria: "#6A38E2",
    corFundo: "#FFFFFF",
    corTexto: "#1A143D",
    corBalaoAgente: "#F1F4F9",
    header: { titulo: "Fale conosco", subtitulo: "Normalmente respondemos rápido" },
    avatarUrl: null,
    posicao: "bottom-right", // bottom-right | bottom-left
    dimensao: "padrao", // compacto | padrao | amplo | tela-cheia
    mensagemBoasVindas: "Olá! Como podemos ajudar?",
    somNotificacao: true,
    poweredBy: true,
  };

  const DIMENSOES = {
    compacto: { width: 360, height: 520 },
    padrao: { width: 400, height: 640 },
    amplo: { width: 440, height: 760 },
  };

  function currentScriptAttrs() {
    const script =
      document.currentScript ||
      document.querySelector('script[data-tenant][data-widget]');
    return {
      tenantId: script.getAttribute("data-tenant"),
      widgetId: script.getAttribute("data-widget"),
      backendUrl: script.getAttribute("data-backend") || "http://localhost:3000",
      socketUrl: script.getAttribute("data-socket") || script.getAttribute("data-backend") || "http://localhost:3000",
    };
  }

  function loadSocketIoClient(cb) {
    if (window.io) return cb();
    const s = document.createElement("script");
    s.src = "https://cdn.socket.io/4.7.5/socket.io.min.js";
    s.onload = cb;
    document.head.appendChild(s);
  }

  function visitorId() {
    let id = localStorage.getItem("tuuvo_visitor_id");
    if (!id) {
      id = "visitor-" + Math.random().toString(36).slice(2) + Date.now();
      localStorage.setItem("tuuvo_visitor_id", id);
    }
    return id;
  }

  function buildStyles(cfg) {
    const dims = DIMENSOES[cfg.dimensao] || DIMENSOES.padrao;
    const side = cfg.posicao === "bottom-left" ? "left" : "right";
    return `
      .tuuvo-bubble {
        position: fixed; bottom: 20px; ${side}: 20px; z-index: 999999;
        width: 60px; height: 60px; border-radius: 50%;
        background: ${cfg.corPrimaria}; box-shadow: 0 4px 14px rgba(0,0,0,.2);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; border: none;
      }
      .tuuvo-bubble svg { width: 28px; height: 28px; fill: #fff; }
      .tuuvo-panel {
        position: fixed; bottom: 92px; ${side}: 20px; z-index: 999999;
        width: ${dims.width}px; height: ${dims.height}px; max-height: 80vh;
        background: ${cfg.corFundo}; border-radius: 16px;
        box-shadow: 0 8px 30px rgba(0,0,0,.25);
        display: none; flex-direction: column; overflow: hidden;
        font-family: Inter, Arial, sans-serif;
      }
      .tuuvo-panel.open { display: flex; }
      .tuuvo-header {
        background: ${cfg.corPrimaria}; color: #fff; padding: 16px;
        display: flex; align-items: center; gap: 10px;
      }
      .tuuvo-header img { width: 32px; height: 32px; border-radius: 50%; }
      .tuuvo-header-text strong { display: block; font-size: 15px; }
      .tuuvo-header-text span { font-size: 12px; opacity: .85; }
      .tuuvo-messages { flex: 1; overflow-y: auto; padding: 12px; background: ${cfg.corFundo}; }
      .tuuvo-msg { max-width: 80%; margin: 6px 0; padding: 8px 12px; border-radius: 12px; font-size: 14px; line-height: 1.4; }
      .tuuvo-msg.visitor { background: ${cfg.corPrimaria}; color: #fff; margin-left: auto; border-bottom-right-radius: 2px; }
      .tuuvo-msg.agente, .tuuvo-msg.bot { background: ${cfg.corBalaoAgente}; color: ${cfg.corTexto}; border-bottom-left-radius: 2px; }
      .tuuvo-input-row { display: flex; border-top: 1px solid #eee; padding: 8px; gap: 8px; }
      .tuuvo-input-row input { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 8px 10px; font-size: 14px; }
      .tuuvo-input-row button { background: ${cfg.corPrimaria}; color: #fff; border: none; border-radius: 8px; padding: 0 14px; cursor: pointer; }
      .tuuvo-powered { text-align: center; font-size: 11px; color: #99a; padding: 4px; }
    `;
  }

  function init() {
    const { tenantId, widgetId, backendUrl, socketUrl } = currentScriptAttrs();
    if (!tenantId) {
      console.error("[TUUVO widget] data-tenant é obrigatório no <script>.");
      return;
    }

    fetch(`${backendUrl}/tenant/widgets/public/${widgetId}`)
      .then((r) => (r.ok ? r.json() : { configJson: {} }))
      .catch(() => ({ configJson: {} }))
      .then((widget) => {
        const cfg = Object.assign({}, DEFAULTS, widget.configJson || {});
        mount(cfg, { tenantId, widgetId, backendUrl, socketUrl });
      });
  }

  function mount(cfg, ctx) {
    const style = document.createElement("style");
    style.textContent = buildStyles(cfg);
    document.head.appendChild(style);

    const bubble = document.createElement("button");
    bubble.className = "tuuvo-bubble";
    bubble.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>';
    document.body.appendChild(bubble);

    const panel = document.createElement("div");
    panel.className = "tuuvo-panel";
    panel.innerHTML = `
      <div class="tuuvo-header">
        ${cfg.avatarUrl ? `<img src="${cfg.avatarUrl}" alt="avatar" />` : ""}
        <div class="tuuvo-header-text">
          <strong>${cfg.header.titulo}</strong>
          <span>${cfg.header.subtitulo}</span>
        </div>
      </div>
      <div class="tuuvo-messages" id="tuuvo-messages"></div>
      <div class="tuuvo-input-row">
        <input id="tuuvo-input" type="text" placeholder="Digite sua mensagem..." />
        <button id="tuuvo-send">Enviar</button>
      </div>
      ${cfg.poweredBy ? '<div class="tuuvo-powered">Powered by TUUVO</div>' : ""}
    `;
    document.body.appendChild(panel);

    bubble.addEventListener("click", () => panel.classList.toggle("open"));

    const messagesEl = panel.querySelector("#tuuvo-messages");
    const inputEl = panel.querySelector("#tuuvo-input");
    const sendBtn = panel.querySelector("#tuuvo-send");

    function appendMessage(text, from) {
      const el = document.createElement("div");
      el.className = `tuuvo-msg ${from}`;
      el.textContent = text;
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    if (cfg.mensagemBoasVindas) appendMessage(cfg.mensagemBoasVindas, "bot");

    const vId = visitorId();

    loadSocketIoClient(() => {
      const socket = window.io(ctx.socketUrl, {
        auth: { tenantId: ctx.tenantId, widgetId: ctx.widgetId },
      });

      socket.on("message:new", (payload) => {
        const msg = payload.message;
        if (msg.remetente_tipo === "agente" || msg.remetente_tipo === "bot") {
          appendMessage(msg.conteudo, msg.remetente_tipo);
        }
      });

      function send() {
        const text = inputEl.value.trim();
        if (!text) return;
        appendMessage(text, "visitor");
        socket.emit("webchat:message", { text, visitorId: vId });
        inputEl.value = "";
      }

      sendBtn.addEventListener("click", send);
      inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") send();
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
