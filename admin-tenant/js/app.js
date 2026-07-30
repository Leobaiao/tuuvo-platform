import { api } from "./api.js";
import { getSession, loadSession, setSession, clearSession } from "./session.js";
import { connectRealtime } from "./socket.js";
import { config } from "./config.js";

import { renderInbox } from "./views/inbox.js";
import { renderRelatorios } from "./views/relatorios.js";
import { renderEquipes } from "./views/equipes.js";
import { renderCanais } from "./views/canais.js";
import { renderWidgetBuilder } from "./views/widgetBuilder.js";
import { renderUsuarios } from "./views/usuarios.js";
import { renderIntegracoes } from "./views/integracoes.js";

const routes = {
  inbox: renderInbox,
  relatorios: renderRelatorios,
  equipes: renderEquipes,
  canais: renderCanais,
  widget: renderWidgetBuilder,
  usuarios: renderUsuarios,
  integracoes: renderIntegracoes,
};

let currentCleanup = null;

function navigate(route) {
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.route === route));
  window.location.hash = route;
  if (typeof currentCleanup === "function") currentCleanup();
  const container = document.getElementById("main-content");
  container.innerHTML = "";
  currentCleanup = routes[route]?.(container) ?? null;
}

function showApp() {
  document.getElementById("login-screen").hidden = true;
  document.getElementById("esqueci-screen").hidden = true;
  document.getElementById("app").hidden = false;
  const session = getSession();
  document.getElementById("current-user").textContent = `${session.user.nome ?? session.user.email} · ${session.user.papel}`;

  // Modo embed (arquitetura v2, seção 13.4): o host (ex.: AltDesk) controla
  // o "chrome" ao redor — nossa sidebar inteira some, painel abre direto na
  // caixa de conversas, sem o agente nem ver a navegação do TUUVO.
  if (config.embed) {
    document.querySelector(".sidebar").style.display = "none";
    try { connectRealtime(); } catch (err) { console.warn("[TUUVO] tempo real indisponível:", err); }
    navigate("inbox");
    return;
  }

  document.querySelectorAll(".nav-item").forEach((el) => el.addEventListener("click", () => navigate(el.dataset.route)));
  try { connectRealtime(); } catch (err) { console.warn("[TUUVO] tempo real indisponível:", err); }
  navigate(window.location.hash.replace("#", "") || "inbox");
}

/**
 * Em modo embed, o host já resolveu autenticação do lado dele (ex.: SSO
 * entre AltDesk e TUUVO, fora do escopo deste frontend) e passa um JWT
 * pronto via querystring — não mostramos tela de login nesse caso.
 */
function tryEmbedAutoLogin() {
  if (!config.embed || !config.embedToken) return false;
  try {
    const payload = JSON.parse(atob(config.embedToken.split(".")[1]));
    setSession(config.embedToken, { email: "", nome: "Agente (via plataforma externa)", papel: payload.papel ?? "agente" });
    return true;
  } catch {
    return false;
  }
}

async function bootstrap() {
  loadSession();
  if (getSession()) { showApp(); return; }
  if (tryEmbedAutoLogin()) { showApp(); return; }

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value;
    const senha = document.getElementById("login-senha").value;
    const errorEl = document.getElementById("login-error");
    errorEl.hidden = true;
    try {
      const { token, user } = await api.post("/tenant/auth/login", { email, senha });
      setSession(token, user);
      showApp();
    } catch {
      errorEl.textContent = "E-mail ou senha inválidos.";
      errorEl.hidden = false;
    }
  });

  document.getElementById("esqueci-senha-link").addEventListener("click", () => {
    document.getElementById("login-screen").hidden = true;
    document.getElementById("esqueci-screen").hidden = false;
  });
  document.getElementById("voltar-login-link").addEventListener("click", () => {
    document.getElementById("esqueci-screen").hidden = true;
    document.getElementById("login-screen").hidden = false;
  });
  document.getElementById("esqueci-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("esqueci-email").value;
    await api.post("/tenant/auth/esqueci-senha", { email });
    alert("Se o e-mail existir, você vai receber um link de redefinição.");
    document.getElementById("esqueci-screen").hidden = true;
    document.getElementById("login-screen").hidden = false;
  });
}

document.getElementById("logout-btn")?.addEventListener("click", () => {
  clearSession();
  window.location.reload();
});

bootstrap();
