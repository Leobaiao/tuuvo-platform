import { api } from "../api.js";
import { toast } from "../toast.js";

const TIPO_LABEL = {
  webchat: "💬 Webchat",
  whatsapp: "📱 WhatsApp",
  sms: "✉️ SMS",
  rcs: "🟢 RCS",
};

export function renderChannels(container) {
  container.innerHTML = `
    <div class="page-pad">
      <h1>Canais</h1>
      <p class="subtitle">Ativados por opção do cliente — nada vem ligado por padrão.</p>

      <div class="card" style="margin-bottom: 20px;">
        <div id="channel-list"><div class="empty-state">Carregando...</div></div>
      </div>

      <div class="card card-pad">
        <div class="toolbar" style="margin-bottom: 12px;">
          <strong>Conectar novo canal</strong>
        </div>
        <div class="row2" style="margin-bottom: 16px;">
          <div class="field">
            <label>Tipo de canal</label>
            <select id="new-channel-tipo">
              <option value="webchat">Webchat (nativo)</option>
              <option value="whatsapp">WhatsApp (GTI)</option>
              <option value="sms">SMS (MKOM)</option>
              <option value="rcs">RCS (MKOM)</option>
            </select>
          </div>
          <div class="field">
            <label>Nome da conexão</label>
            <input type="text" id="new-channel-nome" placeholder="Ex.: Comercial - Loja SP" />
          </div>
        </div>

        <div id="whatsapp-fields" class="row2" style="margin-bottom: 16px;">
          <div class="field">
            <label>Token da instância GTI</label>
            <input type="text" id="wa-token" placeholder="token gerado na plataforma GTI" />
          </div>
          <div class="field">
            <label>Telefone (opcional — gera pair code em vez de QR)</label>
            <input type="text" id="wa-phone" placeholder="5511999999999" />
          </div>
        </div>

        <div id="smsrcs-fields" class="row2" style="margin-bottom: 16px;" hidden>
          <div class="field">
            <label>Cost centre ID (MKOM)</label>
            <input type="number" id="sr-costcentre" placeholder="Ex.: 12345" />
          </div>
        </div>

        <div class="field">
          <label>Departamentos vinculados</label>
          <div id="dept-checkboxes" class="field-hint">Carregando departamentos...</div>
        </div>

        <button class="btn" id="connect-btn">Conectar canal</button>
        <div id="connect-result" style="margin-top: 14px;"></div>
      </div>
    </div>
  `;

  const listEl = container.querySelector("#channel-list");
  const tipoSelect = container.querySelector("#new-channel-tipo");
  const waFields = container.querySelector("#whatsapp-fields");
  const srFields = container.querySelector("#smsrcs-fields");
  const deptCheckboxes = container.querySelector("#dept-checkboxes");
  const resultEl = container.querySelector("#connect-result");

  function toggleFields() {
    const tipo = tipoSelect.value;
    waFields.hidden = tipo !== "whatsapp";
    srFields.hidden = tipo !== "sms" && tipo !== "rcs";
  }
  tipoSelect.addEventListener("change", toggleFields);
  toggleFields();

  async function loadChannels() {
    try {
      const channels = await api.get("/tenant/channels");
      if (!channels.length) {
        listEl.innerHTML = `<div class="empty-state">Nenhum canal conectado ainda.</div>`;
        return;
      }
      listEl.innerHTML = channels
        .map(
          (c) => `
        <div class="list-item">
          <div>
            <div class="list-item-title">${TIPO_LABEL[c.tipo] ?? c.tipo} — ${escapeHtml(c.nome)}</div>
            <div class="list-item-sub">Driver: ${c.driver}</div>
          </div>
          <span class="badge ${c.status}">${c.status}</span>
        </div>`
        )
        .join("");
    } catch {
      listEl.innerHTML = `<div class="empty-state">Não foi possível carregar os canais.</div>`;
    }
  }

  async function loadDepartments() {
    try {
      const depts = await api.get("/tenant/departments");
      if (!depts.length) {
        deptCheckboxes.innerHTML = `Crie um departamento antes de conectar um canal.`;
        return;
      }
      deptCheckboxes.innerHTML = depts
        .map(
          (d) => `
        <label style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:14px; font-weight:400;">
          <input type="checkbox" value="${d.id}" class="dept-check" /> ${escapeHtml(d.nome)}
        </label>`
        )
        .join("");
    } catch {
      deptCheckboxes.innerHTML = "Erro ao carregar departamentos.";
    }
  }

  container.querySelector("#connect-btn").addEventListener("click", async () => {
    const tipo = tipoSelect.value;
    const nome = container.querySelector("#new-channel-nome").value.trim();
    const departmentIds = [...container.querySelectorAll(".dept-check:checked")].map((el) => el.value);

    if (!nome) return toast("Informe um nome para a conexão", "error");
    if (!departmentIds.length) return toast("Selecione ao menos um departamento", "error");

    try {
      let response;
      if (tipo === "webchat") {
        response = await api.post("/tenant/channels/webchat", { nome, departmentIds });
        resultEl.innerHTML = `<div class="badge conectado">Webchat conectado — use o Widget Builder para publicar.</div>`;
      } else if (tipo === "whatsapp") {
        const token = container.querySelector("#wa-token").value.trim();
        const phone = container.querySelector("#wa-phone").value.trim() || undefined;
        if (!token) return toast("Informe o token da instância GTI", "error");
        response = await api.post("/tenant/channels/whatsapp", { nome, token, phone, departmentIds });
        if (response.qrCode) {
          resultEl.innerHTML = `<p class="field-hint">Escaneie o QR code no WhatsApp da empresa:</p>
            <img src="${response.qrCode}" alt="QR code" style="max-width:220px; border-radius:8px; border:1px solid var(--border);" />`;
        } else if (response.pairCode) {
          resultEl.innerHTML = `<div class="badge trial">Código de pareamento: <strong>${response.pairCode}</strong></div>`;
        } else {
          resultEl.innerHTML = `<div class="badge conectado">Conexão iniciada — status: ${response.status}</div>`;
        }
      } else {
        const costCentreId = Number(container.querySelector("#sr-costcentre").value);
        if (!costCentreId) return toast("Informe o cost centre ID da MKOM", "error");
        response = await api.post("/tenant/channels/sms-rcs", { tipo, nome, costCentreId, departmentIds });
        resultEl.innerHTML = `<div class="badge conectado">${tipo.toUpperCase()} conectado via MKOM.</div>`;
      }
      toast("Canal conectado com sucesso");
      loadChannels();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  loadChannels();
  loadDepartments();
  return null;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
