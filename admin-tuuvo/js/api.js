import { config } from "./config.js";
import { getSession, clearSession } from "./session.js";

class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, body) {
  const session = getSession();
  const headers = { "Content-Type": "application/json" };
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;

  let res;
  try {
    res = await fetch(`${config.backendUrl}${path}`, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    console.error("Fetch falhou:", error);
    if (error.name === "TypeError" && error.message.includes("Failed to fetch")) {
      throw new ApiError("Erro de conexão com o servidor. O servidor pode estar fora do ar ou ocorreu um problema de CORS.", 0, error);
    }
    throw new ApiError("Erro de rede inesperado.", 0, error);
  }

  if (res.status === 401) {
    clearSession();
    // Não recarrega a página se for uma tentativa de login, 
    // para permitir que o frontend mostre a mensagem de "senha inválida"
    if (!path.includes("/login")) {
      window.location.reload();
    }
    throw new ApiError("Sessão expirada ou credenciais inválidas", 401);
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    let errorMessage = "Erro na requisição";
    if (typeof data?.error === "string") {
      errorMessage = data.error;
    } else if (data?.error && typeof data.error === "object") {
      if (Array.isArray(data.error.formErrors) && data.error.formErrors.length > 0) {
        errorMessage = data.error.formErrors[0];
      } else if (data.error.fieldErrors && Object.keys(data.error.fieldErrors).length > 0) {
        const firstField = Object.keys(data.error.fieldErrors)[0];
        errorMessage = `${firstField}: ${data.error.fieldErrors[firstField][0]}`;
      } else {
        errorMessage = JSON.stringify(data.error);
      }
    }
    throw new ApiError(errorMessage, res.status, data);
  }
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body),
  put: (path, body) => request("PUT", path, body),
  patch: (path, body) => request("PATCH", path, body),
};
