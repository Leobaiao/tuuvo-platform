const params = new URLSearchParams(window.location.search);

export const config = {
  backendUrl: params.get("backend") || "https://back.tuuvo.app.br",
};
