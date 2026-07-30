import { api } from "../api.js";
import { toast } from "../toast.js";
import { getSession } from "../session.js";
import { config } from "../config.js";

/**
 * Definição de campo, uma entrada por linha da tabela da seção 10.1 da
 * especificação. Adicionar um campo novo ao Widget Builder = adicionar uma
 * linha aqui — o formulário e o binding com o preview são gerados a partir
 * disso, não escritos à mão campo por campo.
 */
const CAMPOS = [
  { categoria: "Aparência", chave: "corPrimaria", label: "Cor primária", tipo: "color", padrao: "#6A38E2", preview: true },
  { categoria: "Aparência", chave: "corFundo", label: "Cor de fundo", tipo: "color", padrao: "#FFFFFF", preview: true },
  { categoria: "Aparência", chave: "corTexto", label: "Cor do texto", tipo: "color", padrao: "#1A143D", preview: true },
  { categoria: "Aparência", chave: "avatarUrl", label: "URL do logo/avatar", tipo: "text", padrao: "" },
  { categoria: "Aparência", chave: "launcherFormato", label: "Formato do launcher", tipo: "select", opcoes: ["circulo", "pilula", "quadrado"], padrao: "circulo" },
  { categoria: "Aparência", chave: "posicao", label: "Posição na tela", tipo: "select", opcoes: ["bottom-right", "bottom-left"], padrao: "bottom-right" },
  { categoria: "Aparência", chave: "tema", label: "Tema", tipo: "select", opcoes: ["claro", "escuro", "automatico"], padrao: "claro" },
  { categoria: "Aparência", chave: "fonte", label: "Fonte", tipo: "select", opcoes: ["Inter", "Plus Jakarta Sans", "Arial"], padrao: "Inter" },
  { categoria: "Aparência", chave: "animacoesAtivas", label: "Animações", tipo: "toggle", padrao: true },
  { categoria: "Abertura", chave: "autoOpen", label: "Abrir automaticamente", tipo: "toggle", padrao: false },
  { categoria: "Abertura", chave: "autoOpenDelaySegundos", label: "Delay pra abrir sozinho (segundos)", tipo: "number", padrao: 5 },
  { categoria: "Abertura", chave: "gatilhoAbertura", label: "Gatilho de abertura", tipo: "select", opcoes: ["tempo_na_pagina", "scroll", "clique"], padrao: "clique" },
  { categoria: "Mensagens", chave: "mensagemBoasVindas", label: "Mensagem de boas-vindas", tipo: "textarea", padrao: "Olá! Como podemos ajudar?", preview: true },
  { categoria: "Mensagens", chave: "mensagemForaHorario", label: "Mensagem fora do horário", tipo: "textarea", padrao: "Estamos fora do horário de atendimento." },
  { categoria: "Mensagens", chave: "mensagemDespedida", label: "Mensagem de despedida", tipo: "textarea", padrao: "Obrigado pelo contato!" },
  { categoria: "Horário", chave: "fusoHorario", label: "Fuso horário", tipo: "select", opcoes: ["America/Sao_Paulo", "America/Manaus", "UTC"], padrao: "America/Sao_Paulo" },
  { categoria: "Roteamento", chave: "idioma", label: "Idioma de atendimento", tipo: "select", opcoes: ["pt-BR", "en-US", "es-ES"], padrao: "pt-BR" },
  { categoria: "Roteamento", chave: "escalonamentoBotHumano", label: "Escalonamento bot→humano", tipo: "select", opcoes: ["sempre", "apos_3_perguntas", "nunca"], padrao: "sempre" },
  { categoria: "Identidade", chave: "exigirEmail", label: "Exigir e-mail antes de conversar", tipo: "toggle", padrao: false },
  { categoria: "Identidade", chave: "exigirCpf", label: "Exigir CPF antes de conversar", tipo: "toggle", padrao: false },
  { categoria: "Bots/IA", chave: "tomBot", label: "Tom do bot", tipo: "select", opcoes: ["formal", "casual", "tecnico"], padrao: "casual" },
  { categoria: "Notificações", chave: "somNotificacao", label: "Som de notificação", tipo: "toggle", padrao: true },
  { categoria: "Notificações", chave: "badgeAtivo", label: "Badge de não lida", tipo: "toggle", padrao: true },
  { categoria: "Notificações", chave: "emailTranscricao", label: "E-mail de transcrição ao fim do chat", tipo: "toggle", padrao: false },
  { categoria: "Notificações", chave: "webhookCustomizadoUrl", label: "URL de webhook customizado", tipo: "text", padrao: "" },
  { categoria: "Segmentação", chave: "segmentoTag", label: "Segmento de cliente (tag)", tipo: "text", padrao: "" },
  { categoria: "LGPD", chave: "textoConsentimentoLgpd", label: "Texto do aviso de consentimento", tipo: "textarea", padrao: "Ao continuar, você concorda com nossa Política de Privacidade." },
  { categoria: "Acessibilidade", chave: "altoContrasteDisponivel", label: "Alto contraste disponível pro visitante", tipo: "toggle", padrao: true },
  { categoria: "Analytics", chave: "gaTrackingId", label: "ID do Google Analytics/GTM", tipo: "text", padrao: "" },
];

const DEFAULTS = Object.fromEntries(CAMPOS.map((c) => [c.chave, c.padrao]));

export function renderWidgetBuilder(container) {
  container.innerHTML = `
    <div class="page-pad" style="padding-bottom:0;">
      <h1>Widget Builder</h1>
      <p class="subtitle">Todo campo aqui é dado, não deploy — o preview atualiza em tempo real e é exatamente o que fica salvo (seção 10.1).</p>
    </div>
    <div class="builder-grid">
      <div id="form-cols"></div>
      <div class="preview-wrap">
        <div style="text-align:center; font-size:12px; color:var(--cinza-texto); margin-bottom:12px;">Preview ao vivo</div>
        <div class="preview-frame">
          <div class="w-panel" id="w-panel">
            <div class="w-header" id="w-header"><strong id="w-titulo">TUUVO</strong></div>
            <div class="w-messages"><div class="w-msg" id="w-boasvindas"></div></div>
            <div class="w-input"><input type="text" placeholder="Digite sua mensagem..." disabled /><button id="w-send">Enviar</button></div>
          </div>
        </div>
        <div style="margin-top:20px; display:flex; gap:10px;">
          <button class="btn secondary" id="save-draft-btn">Salvar rascunho</button>
          <button class="btn" id="publish-btn">Publicar</button>
        </div>
        <div id="embed-snippet-wrap" style="margin-top:20px;"></div>
      </div>
    </div>
  `;

  const formColsEl = container.querySelector("#form-cols");
  let widget = null;
  let configState = { ...DEFAULTS };

  function renderForm() {
    const categorias = [...new Set(CAMPOS.map((c) => c.categoria))];
    formColsEl.innerHTML = categorias.map((cat) => `
      <div class="builder-category">
        <h3>${cat}</h3>
        <div class="card card-pad">
          ${CAMPOS.filter((c) => c.categoria === cat).map(renderCampo).join("")}
        </div>
      </div>
    `).join("");

    CAMPOS.forEach((c) => {
      const el = formColsEl.querySelector(`#campo-${c.chave}`);
      if (!el) return;
      const evento = c.tipo === "toggle" ? "change" : "input";
      el.addEventListener(evento, () => {
        configState[c.chave] = c.tipo === "toggle" ? el.checked : (c.tipo === "number" ? Number(el.value) : el.value);
        applyPreview();
      });
    });
  }

  function renderCampo(c) {
    const valor = configState[c.chave];
    if (c.tipo === "toggle") {
      return `<div class="field"><label style="display:flex; justify-content:space-between; align-items:center;"><span>${c.label}</span>
        <input type="checkbox" id="campo-${c.chave}" ${valor ? "checked" : ""} /></label></div>`;
    }
    if (c.tipo === "select") {
      return `<div class="field"><label>${c.label}</label><select id="campo-${c.chave}">
        ${c.opcoes.map((o) => `<option value="${o}" ${valor === o ? "selected" : ""}>${o}</option>`).join("")}
      </select></div>`;
    }
    if (c.tipo === "textarea") {
      return `<div class="field"><label>${c.label}</label><textarea id="campo-${c.chave}" rows="2">${escapeHtml(valor)}</textarea></div>`;
    }
    if (c.tipo === "color") {
      return `<div class="field"><label>${c.label}</label><input type="color" id="campo-${c.chave}" value="${valor}" /></div>`;
    }
    if (c.tipo === "number") {
      return `<div class="field"><label>${c.label}</label><input type="number" id="campo-${c.chave}" value="${valor}" /></div>`;
    }
    return `<div class="field"><label>${c.label}</label><input type="text" id="campo-${c.chave}" value="${escapeHtml(valor)}" /></div>`;
  }

  function applyPreview() {
    container.querySelector("#w-header").style.background = configState.corPrimaria;
    container.querySelector("#w-panel").style.background = configState.corFundo;
    container.querySelector("#w-send").style.background = configState.corPrimaria;
    const boasVindasEl = container.querySelector("#w-boasvindas");
    boasVindasEl.textContent = configState.mensagemBoasVindas;
    boasVindasEl.style.background = "#F1F4F9";
    boasVindasEl.style.color = configState.corTexto;
  }

  function showEmbedSnippet() {
    const wrap = container.querySelector("#embed-snippet-wrap");
    if (!widget.publicado) {
      wrap.innerHTML = `<div class="field-hint" style="font-size:13px; color:var(--cinza-texto);">Publique o widget pra gerar o snippet de embed.</div>`;
      return;
    }
    const session = getSession();
    const snippet =
      `<script src="${config.backendUrl}/tuuvo-widget.js"\n` +
      `  data-tenant="${session.user.tenantId}"\n` +
      `  data-widget="${widget.id}"\n` +
      `  data-backend="${config.backendUrl}"></script>`;
    wrap.innerHTML = `
      <label style="font-size:13px; font-weight:600; display:block; margin-bottom:6px;">Snippet de embed — cole antes do &lt;/body&gt; do site do tenant</label>
      <textarea readonly rows="5" style="width:100%; font-family:monospace; font-size:12px; padding:10px; border:1px solid var(--border); border-radius:8px;">${escapeHtml(snippet)}</textarea>
      <div style="font-size:12px; color:var(--cinza-texto); margin-top:6px;">Funciona em qualquer aplicação externa — WordPress, React, HTML estático — sem depender de framework nenhum do lado do tenant.</div>
    `;
  }

  async function loadOrCreate() {
    const widgets = await api.get("/tenant/widgets");
    if (widgets.length) {
      widget = widgets[0];
      configState = { ...DEFAULTS, ...widget.config_json };
    } else {
      widget = await api.post("/tenant/widgets", { nome: "Widget principal", configJson: DEFAULTS });
      configState = { ...DEFAULTS };
    }
    renderForm();
    applyPreview();
    showEmbedSnippet();
  }

  async function save(publicar) {
    try {
      widget = await api.put(`/tenant/widgets/${widget.id}`, { nome: widget.nome, configJson: configState });
      if (publicar) {
        widget = await api.post(`/tenant/widgets/${widget.id}/publish`, {});
        toast("Widget publicado!");
      } else {
        toast("Rascunho salvo");
      }
      showEmbedSnippet();
    } catch (err) { toast(err.message, "error"); }
  }

  container.querySelector("#save-draft-btn").addEventListener("click", () => save(false));
  container.querySelector("#publish-btn").addEventListener("click", () => save(true));

  loadOrCreate().catch((err) => {
    formColsEl.innerHTML = `<div class="empty-state">Erro ao carregar widget: ${err.message}</div>`;
  });

  return null;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
