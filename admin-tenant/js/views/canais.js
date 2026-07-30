import { api } from "../api.js";
import { toast } from "../toast.js";

const TIPO_LABEL = {
  webchat: "💬 Webchat", whatsapp_gti: "📱 WhatsApp (não-oficial)",
  whatsapp_zernio: "✅ WhatsApp (oficial)", zernio_instagram: "📸 Instagram",
  zernio_telegram: "✈️ Telegram", zernio_facebook: "👍 Facebook", zernio_x: "✕ X",
  zernio_bluesky: "🦋 Bluesky", zernio_reddit: "👽 Reddit", rcs: "🟢 RCS", email: "✉️ E-mail",
};

export function renderCanais(container) {
  container.innerHTML = `
    <div class="page-pad">
      <h1>Canais</h1>
      <p class="subtitle">5 famílias de canal — webchat, WhatsApp (não-oficial ou oficial via Zernio), redes sociais (Zernio), RCS e e-mail.</p>

      <div class="card" style="margin-bottom:20px;"><div id="channel-list"><div class="empty-state">Carregando...</div></div></div>

      <div class="card card-pad">
        <div class="toolbar" style="margin-bottom:12px;"><strong>Conectar novo canal</strong></div>
        <div class="field">
          <label>Tipo</label>
          <select id="tipo">
            <option value="webchat">Webchat</option>
            <option value="whatsapp_gti">WhatsApp — não-oficial (GTI)</option>
            <option value="whatsapp_zernio">WhatsApp — oficial (Zernio)</option>
            <option value="zernio_social">Rede social (Zernio)</option>
            <option value="rcs">RCS (MKOM)</option>
            <option value="email">E-mail</option>
          </select>
        </div>
        <div class="field"><label>Nome da conexão</label><input type="text" id="nome" placeholder="Ex.: Comercial - Loja SP" /></div>

        <div id="campos-gti" class="row2" hidden>
          <div class="field"><label>Token da instância GTI</label><input type="text" id="gti-token" /></div>
          <div class="field"><label>Telefone (opcional, gera pair code)</label><input type="text" id="gti-phone" /></div>
        </div>

        <div id="campos-zernio" hidden>
          <div class="field" id="campo-plataforma-social" hidden>
            <label>Plataforma</label>
            <select id="zernio-platform"><option value="instagram">Instagram</option><option value="telegram">Telegram</option><option value="facebook">Facebook</option><option value="x">X</option><option value="bluesky">Bluesky</option><option value="reddit">Reddit</option></select>
          </div>
          <div class="row2">
            <div class="field"><label>Profile ID (Zernio)</label><input type="text" id="zernio-profile" /></div>
            <div class="field"><label>Account ID (Zernio)</label><input type="text" id="zernio-account" /></div>
          </div>
        </div>

        <div id="campos-rcs" class="field" hidden>
          <label>Cost centre ID (MKOM)</label><input type="number" id="rcs-costcentre" />
        </div>

        <div id="campos-email" class="row2" hidden>
          <div class="field"><label>Host IMAP</label><input type="text" id="email-imap" /></div>
          <div class="field"><label>Host SMTP</label><input type="text" id="email-smtp" /></div>
          <div class="field" style="grid-column: span 2;"><label>Endereço de e-mail</label><input type="email" id="email-endereco" /></div>
        </div>

        <div class="field">
          <label>Equipes vinculadas</label>
          <div id="equipe-checks" class="field-hint">Carregando equipes...</div>
        </div>

        <button class="btn" id="connect-btn">Conectar canal</button>
        <div id="result" style="margin-top:14px;"></div>
      </div>
    </div>
  `;

  const listEl = container.querySelector("#channel-list");
  const tipoSel = container.querySelector("#tipo");
  const camposGti = container.querySelector("#campos-gti");
  const camposZernio = container.querySelector("#campos-zernio");
  const campoPlataformaSocial = container.querySelector("#campo-plataforma-social");
  const camposRcs = container.querySelector("#campos-rcs");
  const camposEmail = container.querySelector("#campos-email");
  const equipeChecks = container.querySelector("#equipe-checks");
  const resultEl = container.querySelector("#result");

  function toggleFields() {
    const t = tipoSel.value;
    camposGti.hidden = t !== "whatsapp_gti";
    camposZernio.hidden = t !== "whatsapp_zernio" && t !== "zernio_social";
    campoPlataformaSocial.hidden = t !== "zernio_social";
    camposRcs.hidden = t !== "rcs";
    camposEmail.hidden = t !== "email";
  }
  tipoSel.addEventListener("change", toggleFields);
  toggleFields();

  async function loadChannels() {
    const rows = await api.get("/tenant/channels");
    listEl.innerHTML = rows.length
      ? rows.map((c) => `
        <div style="display:flex; justify-content:space-between; padding:14px 20px; border-bottom:1px solid var(--border);">
          <div><strong>${TIPO_LABEL[c.tipo] ?? c.tipo} — ${escapeHtml(c.nome)}</strong><div style="font-size:12px; color:var(--cinza-texto);">driver: ${c.driver}</div></div>
          <span class="badge ${c.status === "conectado" ? "ativo" : "avaliacao"}">${c.status}</span>
        </div>`).join("")
      : `<div class="empty-state">Nenhum canal conectado ainda.</div>`;
  }

  async function loadEquipes() {
    const equipes = await api.get("/tenant/equipes");
    equipeChecks.innerHTML = equipes.length
      ? equipes.map((e) => `<label style="display:flex; gap:8px; margin-bottom:6px; font-weight:400;"><input type="checkbox" value="${e.id}" class="eq-check" /> ${escapeHtml(e.nome)}</label>`).join("")
      : "Crie uma equipe antes de conectar um canal.";
  }

  container.querySelector("#connect-btn").addEventListener("click", async () => {
    const tipo = tipoSel.value;
    const nome = container.querySelector("#nome").value.trim();
    const equipeIds = [...container.querySelectorAll(".eq-check:checked")].map((el) => el.value);
    if (!nome) return toast("Informe um nome", "error");
    if (!equipeIds.length) return toast("Selecione ao menos uma equipe", "error");

    try {
      let resp;
      if (tipo === "webchat") {
        resp = await api.post("/tenant/channels/webchat", { nome, equipeIds });
        resultEl.innerHTML = `<div class="badge ativo">Webchat conectado.</div>`;
      } else if (tipo === "whatsapp_gti") {
        const token = container.querySelector("#gti-token").value.trim();
        const phone = container.querySelector("#gti-phone").value.trim() || undefined;
        if (!token) return toast("Informe o token GTI", "error");
        resp = await api.post("/tenant/channels/whatsapp-gti", { nome, token, phone, equipeIds });
        resultEl.innerHTML = resp.qrCode
          ? `<img src="${resp.qrCode}" style="max-width:220px; border-radius:8px;" />`
          : `<div class="badge ativo">Conexão iniciada — status: ${resp.status}</div>`;
      } else if (tipo === "whatsapp_zernio" || tipo === "zernio_social") {
        const platform = tipo === "whatsapp_zernio" ? "whatsapp" : container.querySelector("#zernio-platform").value;
        const profileId = container.querySelector("#zernio-profile").value.trim();
        const accountId = container.querySelector("#zernio-account").value.trim();
        if (!profileId || !accountId) return toast("Informe Profile ID e Account ID da Zernio", "error");
        resp = await api.post("/tenant/channels/zernio", { nome, platform, profileId, accountId, equipeIds });
        resultEl.innerHTML = `<div class="badge ativo">Canal Zernio (${platform}) conectado.</div>`;
      } else if (tipo === "rcs") {
        const costCentreId = Number(container.querySelector("#rcs-costcentre").value);
        if (!costCentreId) return toast("Informe o cost centre ID", "error");
        resp = await api.post("/tenant/channels/rcs", { nome, costCentreId, equipeIds });
        resultEl.innerHTML = `<div class="badge ativo">RCS conectado.</div>`;
      } else if (tipo === "email") {
        const imapHost = container.querySelector("#email-imap").value.trim();
        const smtpHost = container.querySelector("#email-smtp").value.trim();
        const enderecoRemetente = container.querySelector("#email-endereco").value.trim();
        if (!imapHost || !smtpHost || !enderecoRemetente) return toast("Preencha IMAP, SMTP e endereço", "error");
        resp = await api.post("/tenant/channels/email", { nome, imapHost, smtpHost, enderecoRemetente, equipeIds });
        resultEl.innerHTML = `<div class="badge ativo">E-mail conectado — lembre-se do delimitador nas respostas.</div>`;
      }
      toast("Canal conectado com sucesso");
      loadChannels();
    } catch (err) { toast(err.message, "error"); }
  });

  loadChannels();
  loadEquipes();
  return null;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
