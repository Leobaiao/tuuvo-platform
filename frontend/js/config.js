// Config lida via query string, pra funcionar tanto standalone quanto embutida
// (ex.: o AltDesk abrindo isto num <iframe src="...?backend=https://api.tuuvo.app.br&embed=1&token=...">).
// Ver seção 9 da especificação (Sandbox e SDK de embed).
const params = new URLSearchParams(window.location.search);

export const config = {
  backendUrl: params.get("backend") || "http://localhost:3000",
  embed: params.get("embed") === "1",
  embedToken: params.get("token") || null,
};
