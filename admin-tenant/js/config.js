// Lido via querystring, pra não precisar rebuild pra trocar de backend
// (ex.: apontar pra staging vs. produção), e pro modo embed (arquitetura v2,
// seção 13.4) — quando este painel roda dentro de um <iframe> de outra
// plataforma. AltDesk é a primeira a integrar, mas o mecanismo não é
// exclusivo dela — qualquer plataforma com uma API key ativa (seção 13.2)
// pode usar o mesmo caminho. O host passa token pronto e pede pra esconder
// a navegação lateral, mostrando só a caixa de conversas.
const params = new URLSearchParams(window.location.search);

export const config = {
  backendUrl: params.get("backend") || "https://api.tuuvo.app.br",
  embed: params.get("embed") === "1",
  embedToken: params.get("token") || null,
};
