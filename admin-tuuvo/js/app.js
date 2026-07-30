import { api } from "./api.js";
import { getSession, loadSession, setSession, clearSession } from "./session.js";

import { renderDashboard } from "./views/dashboard.js";
import { renderTenants } from "./views/tenants.js";
import { renderPlanos } from "./views/planos.js";
import { renderProviders } from "./views/providers.js";
import { renderUsuarios } from "./views/usuarios.js";

const routes = {
  dashboard: renderDashboard,
  tenants: renderTenants,
  planos: renderPlanos,
  providers: renderProviders,
  usuarios: renderUsuarios,
};

function navigate(route) {
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.route === route);
  });
  window.location.hash = route;
  const container = document.getElementById("main-content");
  container.innerHTML = "";
  routes[route]?.(container);
}

function showApp() {
  document.getElementById("login-screen").hidden = true;
  document.getElementById("app").hidden = false;
  const session = getSession();
  document.getElementById("current-user").textContent = `${session.user.nome ?? session.user.email} · ${session.user.papel}`;

  document.querySelectorAll(".nav-item").forEach((el) => {
    el.addEventListener("click", () => navigate(el.dataset.route));
  });
  navigate(window.location.hash.replace("#", "") || "dashboard");
}

async function bootstrap() {
  loadSession();
  if (getSession()) { showApp(); return; }

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value;
    const senha = document.getElementById("login-senha").value;
    const errorEl = document.getElementById("login-error");
    errorEl.hidden = true;
    try {
      const { token, user } = await api.post("/tuuvo/auth/login", { email, senha });
      setSession(token, user);
      showApp();
    } catch {
      errorEl.textContent = "E-mail ou senha inválidos.";
      errorEl.hidden = false;
    }
  });
}

document.getElementById("logout-btn")?.addEventListener("click", () => {
  clearSession();
  window.location.reload();
});

bootstrap();
