import { config } from "./config.js";
import { api } from "./api.js";
import { getSession, loadSession, setSession, clearSession } from "./session.js";
import { connectRealtime } from "./socket.js";
import { toast } from "./toast.js";

import { renderInbox } from "./views/inbox.js";
import { renderDepartments } from "./views/departments.js";
import { renderChannels } from "./views/channels.js";
import { renderBuilder } from "./views/widgetBuilder.js";
import { renderTeam } from "./views/team.js";

const routes = {
  inbox: renderInbox,
  departments: renderDepartments,
  channels: renderChannels,
  builder: renderBuilder,
  team: renderTeam,
};

let currentCleanup = null;

function navigate(route) {
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.route === route);
  });
  window.location.hash = route;

  if (typeof currentCleanup === "function") currentCleanup();
  const container = document.getElementById("main-content");
  container.innerHTML = "";
  currentCleanup = routes[route]?.(container) ?? null;
}

function showApp() {
  document.getElementById("login-screen").hidden = true;
  const app = document.getElementById("app");
  app.hidden = false;

  const session = getSession();
  document.getElementById("current-user").textContent =
    `${session.user.nome ?? session.user.email} · ${session.user.papel}`;

  // Modo embutido (iframe do AltDesk, seção 9): esconde a navegação lateral
  // inteira e abre direto na caixa de conversas — o host controla o "chrome".
  if (config.embed) {
    document.querySelector(".sidebar").style.display = "none";
    navigate("inbox");
    return;
  }

  document.querySelectorAll(".nav-item").forEach((el) => {
    el.addEventListener("click", () => navigate(el.dataset.route));
  });

  // connectRealtime() já se protege internamente (ver socket.js), mas o
  // try/catch aqui é a segunda linha de defesa: nenhuma falha de setup deve
  // impedir a navegação principal de aparecer.
  try {
    connectRealtime();
  } catch (err) {
    console.warn("[TUUVO] Falha ao iniciar tempo real:", err);
  }

  navigate(window.location.hash.replace("#", "") || "inbox");
}

async function tryEmbedAutoLogin() {
  // Em modo embutido, o host (ex.: AltDesk) já resolveu a autenticação do
  // lado dele e nos passa um token pronto via querystring — não mostramos
  // tela de login nesse caso.
  if (!config.embed || !config.embedToken) return false;
  try {
    // O token embutido já É o JWT da TUUVO (emitido via integração
    // server-to-server entre AltDesk e o backend da TUUVO — fora do escopo
    // deste frontend, ver seção 9 da especificação).
    const payload = JSON.parse(atob(config.embedToken.split(".")[1]));
    setSession(config.embedToken, { email: "", nome: "Agente (via AltDesk)", papel: payload.papel });
    return true;
  } catch {
    return false;
  }
}

async function bootstrap() {
  loadSession();

  if (getSession()) {
    showApp();
    return;
  }

  if (await tryEmbedAutoLogin()) {
    showApp();
    return;
  }

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value;
    const senha = document.getElementById("login-senha").value;
    const errorEl = document.getElementById("login-error");
    errorEl.hidden = true;

    try {
      const { token, user } = await api.post("/auth/login", { email, senha });
      setSession(token, user);
      showApp();
    } catch (err) {
      errorEl.textContent = "E-mail ou senha inválidos.";
      errorEl.hidden = false;
    }
  });

  const togglePasswordBtn = document.getElementById("toggle-password");
  if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener("click", () => {
      const passwordInput = document.getElementById("login-senha");
      const iconEye = togglePasswordBtn.querySelector(".icon-eye");
      const iconEyeOff = togglePasswordBtn.querySelector(".icon-eye-off");
      
      if (passwordInput.type === "password") {
        passwordInput.type = "text";
        iconEye.hidden = true;
        iconEyeOff.hidden = false;
      } else {
        passwordInput.type = "password";
        iconEye.hidden = false;
        iconEyeOff.hidden = true;
      }
    });
  }
}

document.getElementById("logout-btn")?.addEventListener("click", () => {
  clearSession();
  window.location.reload();
});

bootstrap();
