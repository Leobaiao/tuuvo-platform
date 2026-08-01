// Lido via querystring, pra não precisar rebuild pra trocar de backend
// (ex.: apontar pra staging vs. produção).
const params = new URLSearchParams(window.location.search);

export const config = {
  backendUrl: params.get("backend") || "https://back.tuuvo.app.br",
};
