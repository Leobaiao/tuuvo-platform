import { config } from "./config.js";
import { getSession } from "./session.js";

let socket = null;
const listeners = {};

export function connectRealtime() {
  const session = getSession();
  if (!session?.token) return;

  if (typeof window.io !== "function") {
    // CDN do Socket.IO não carregou (rede lenta, bloqueio de firewall/adblocker,
    // etc.) — o painel continua funcional via REST, só sem tempo real até
    // recarregar. Isso não pode derrubar o resto da UI.
    console.warn("[TUUVO] Socket.IO indisponível — painel funcionando sem tempo real.");
    return;
  }

  // io() vem do CDN carregado em index.html (mesma abordagem do widget de embed).
  socket = window.io(config.backendUrl, { auth: { token: session.token } });

  socket.on("message:new", (payload) => emit("message:new", payload));
  socket.on("conversation:updated", (payload) => emit("conversation:updated", payload));
}

export function onRealtime(event, cb) {
  if (!listeners[event]) listeners[event] = new Set();
  listeners[event].add(cb);
  return () => listeners[event].delete(cb);
}

function emit(event, payload) {
  (listeners[event] ?? new Set()).forEach((cb) => cb(payload));
}
