const STORAGE_KEY = "tuuvo_admin_session"; // chave DIFERENTE da sessão de tenant —
// os dois nunca compartilham localStorage mesmo que abertos no mesmo navegador.

let current = null;

export function loadSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { current = JSON.parse(raw); } catch { current = null; }
  }
  return current;
}

export function setSession(token, user) {
  current = { token, user };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}

export function clearSession() {
  current = null;
  localStorage.removeItem(STORAGE_KEY);
}

export function getSession() {
  return current;
}
