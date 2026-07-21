import { api } from "../api.js";
import { toast } from "../toast.js";
import { getSession } from "../session.js";
import { config } from "../config.js";

const DEFAULTS = {
  header: { titulo: "Fale conosco", subtitulo: "Normalmente respondemos rápido" },
  corPrimaria: "#6A38E2",
  corFundo: "#FFFFFF",
  corTexto: "#1A143D",
  dimensao: "padrao",
  posicao: "bottom-right",
  mensagemBoasVindas: "Olá! Como podemos ajudar?",
  somNotificacao: true,
  poweredBy: true,
};

export function renderBuilder(container) {
  container.innerHTML = `
    <div class="page-pad" style="padding-bottom: 0;">
      <h1>Widget Builder</h1>
      <p class="subtitle">Tudo aqui é dado, não deploy — o preview atualiza em tempo real.</p>
    </div>

    <div class="builder-grid">
      <div class="card card-pad" id="builder-form">
        <div class="empty-state">Carregando...</div>
      </div>

      <div class="preview-wrap">
        <div class="preview-label">Preview ao vivo</div>
        <div class="preview-frame">
          <div class="w-panel" id="w-panel">
            <div class="w-header" id="w-header">
              <img class="w-avatar" src="assets/tuuvo-mark.png" alt="TUUVO" />
              <div class="w-header-text">
                <strong id="w-titulo"></strong>
                <span id="w-subtitulo"></span>
              </div>
            </div>
            <div class="w-messages" id="w-messages">
              <div class="w-msg bot" id="w-boasvindas"></div>
            </div>
            <div class="w-input">
              <input type="text" placeholder="Digite sua mensagem..." disabled />
              <button id="w-sendbtn">Enviar</button>
            </div>
            <div class="w-powered" id="w-powered">Powered by TUUVO</div>
          </div>
          <div class="w-bubble" id="w-bubble">
            <svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>
          </div>
        </div>
      </div>
    </div>
  `;

  const formEl = container.querySelector("#builder-form");
  let widget = null;

  async function loadOrCreate() {
    const widgets = await api.get("/tenant/widgets");
    if (widgets.length) {
      widget = widgets[0];
      widget.config_json = { ...DEFAULTS, ...widget.config_json };
    } else {
      widget = await api.post("/tenant/widgets", { nome: "Widget principal", configJson: DEFAULTS });
    }
    renderForm();
    applyPreview();
  }

  function renderForm() {
    const cfg = widget.config_json;
    formEl.innerHTML = `
      <div class="field">
        <label>Título do header</label>
        <input type="text" id="in-titulo" value="${escapeAttr(cfg.header.titulo)}" />
      </div>
      <div class="field">
        <label>Subtítulo</label>
        <input type="text" id="in-subtitulo" value="${escapeAttr(cfg.header.subtitulo)}" />
      </div>
      <div class="field">
        <label>Mensagem de boas-vindas</label>
        <textarea id="in-boasvindas" rows="2">${escapeAttr(cfg.mensagemBoasVindas)}</textarea>
      </div>

      <div class="field">
        <label>Cores</label>
        <div class="color-row">
          <div class="color-field">
            <input type="color" id="in-corprimaria" value="${cfg.corPrimaria}" />
            <div class="field-hint">Primária</div>
          </div>
          <div class="color-field">
            <input type="color" id="in-corfundo" value="${cfg.corFundo}" />
            <div class="field-hint">Fundo</div>
          </div>
          <div class="color-field">
            <input type="color" id="in-cortexto" value="${cfg.corTexto}" />
            <div class="field-hint">Texto</div>
          </div>
        </div>
      </div>

      <div class="row2">
        <div class="field">
          <label>Dimensão</label>
          <select id="in-dimensao">
            <option value="compacto" ${cfg.dimensao === "compacto" ? "selected" : ""}>Compacto (360×520)</option>
            <option value="padrao" ${cfg.dimensao === "padrao" ? "selected" : ""}>Padrão (400×640)</option>
            <option value="amplo" ${cfg.dimensao === "amplo" ? "selected" : ""}>Amplo (440×760)</option>
          </select>
        </div>
        <div class="field">
          <label>Posição</label>
          <select id="in-posicao">
            <option value="bottom-right" ${cfg.posicao === "bottom-right" ? "selected" : ""}>Canto inferior direito</option>
            <option value="bottom-left" ${cfg.posicao === "bottom-left" ? "selected" : ""}>Canto inferior esquerdo</option>
          </select>
        </div>
      </div>

      <div class="switch-row">
        <span>Som de notificação</span>
        <label class="toggle"><input type="checkbox" id="in-som" ${cfg.somNotificacao ? "checked" : ""} /><span class="slider"></span></label>
      </div>
      <div class="switch-row">
        <span>Mostrar "Powered by TUUVO"</span>
        <label class="toggle"><input type="checkbox" id="in-powered" ${cfg.poweredBy ? "checked" : ""} /><span class="slider"></span></label>
      </div>

      <div style="margin-top: 20px; display:flex; gap:10px;">
        <button class="btn secondary" id="save-draft-btn">Salvar rascunho</button>
        <button class="btn" id="publish-btn">Publicar widget</button>
      </div>

      ${widget.publicado ? `<div style="margin-top:16px;"><span class="badge conectado">Publicado (v${widget.versao})</span></div>` : `<div style="margin-top:16px;"><span class="badge neutro">Rascunho — ainda não publicado</span></div>`}

      <div id="embed-snippet" style="margin-top:16px;"></div>
    `;

    [
      "in-titulo", "in-subtitulo", "in-boasvindas",
      "in-corprimaria", "in-corfundo", "in-cortexto",
      "in-dimensao", "in-posicao", "in-som", "in-powered",
    ].forEach((id) => formEl.querySelector(`#${id}`).addEventListener("input", applyPreview));

    formEl.querySelector("#save-draft-btn").addEventListener("click", () => save(false));
    formEl.querySelector("#publish-btn").addEventListener("click", () => save(true));

    if (widget.publicado) showEmbedSnippet();
  }

  function readForm() {
    return {
      header: {
        titulo: formEl.querySelector("#in-titulo").value || "Fale conosco",
        subtitulo: formEl.querySelector("#in-subtitulo").value || "",
      },
      mensagemBoasVindas: formEl.querySelector("#in-boasvindas").value,
      corPrimaria: formEl.querySelector("#in-corprimaria").value,
      corFundo: formEl.querySelector("#in-corfundo").value,
      corTexto: formEl.querySelector("#in-cortexto").value,
      dimensao: formEl.querySelector("#in-dimensao").value,
      posicao: formEl.querySelector("#in-posicao").value,
      somNotificacao: formEl.querySelector("#in-som").checked,
      poweredBy: formEl.querySelector("#in-powered").checked,
    };
  }

  function applyPreview() {
    const cfg = readForm();
    const dims = { compacto: "260px", padrao: "300px", amplo: "330px" };

    container.querySelector("#w-header").style.background = cfg.corPrimaria;
    container.querySelector("#w-bubble").style.background = cfg.corPrimaria;
    container.querySelector("#w-sendbtn").style.background = cfg.corPrimaria;
    container.querySelector("#w-panel").style.background = cfg.corFundo;
    container.querySelector("#w-messages").style.background = cfg.corFundo;
    container.querySelector("#w-panel").style.width = dims[cfg.dimensao] || "300px";
    container.querySelector("#w-titulo").textContent = cfg.header.titulo;
    container.querySelector("#w-subtitulo").textContent = cfg.header.subtitulo;
    const boasVindasEl = container.querySelector("#w-boasvindas");
    boasVindasEl.textContent = cfg.mensagemBoasVindas;
    boasVindasEl.style.background = "#F1F4F9";
    boasVindasEl.style.color = cfg.corTexto;
    container.querySelector("#w-powered").style.display = cfg.poweredBy ? "block" : "none";
  }

  async function save(publish) {
    try {
      const configJson = readForm();
      widget = await api.put(`/tenant/widgets/${widget.id}`, {
        nome: widget.nome,
        configJson,
      });
      widget.config_json = { ...DEFAULTS, ...widget.config_json };

      if (publish) {
        widget = await api.post(`/tenant/widgets/${widget.id}/publish`, {});
        widget.config_json = { ...DEFAULTS, ...widget.config_json };
        toast("Widget publicado! Já pode ser embutido.");
      } else {
        toast("Rascunho salvo");
      }
      renderForm();
      applyPreview();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function showEmbedSnippet() {
    const snippetEl = formEl.querySelector("#embed-snippet");
    const session = getSession();
    const snippet =
      `<script src="${config.backendUrl}/tuuvo-widget.js"\n` +
      `  data-tenant="${session.user.tenantId}"\n` +
      `  data-widget="${widget.id}"\n` +
      `  data-backend="${config.backendUrl}"\n` +
      `  data-socket="${config.backendUrl}"></script>`;
    snippetEl.innerHTML = `
      <label style="font-size:13px; font-weight:600; display:block; margin-bottom:6px;">Snippet de embed</label>
      <textarea readonly rows="6" style="width:100%; font-family:monospace; font-size:12px; padding:10px; border:1px solid var(--border); border-radius:8px;">${escapeAttr(snippet)}</textarea>
      <div class="field-hint">Cole isso antes do &lt;/body&gt; do site do cliente, ou use a mesma URL do widget.js num &lt;iframe&gt; dentro do AltDesk (seção 9 da especificação).</div>
    `;
  }

  loadOrCreate().catch((err) => {
    formEl.innerHTML = `<div class="empty-state">Erro ao carregar widget: ${err.message}</div>`;
  });

  return null;
}

function escapeAttr(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
