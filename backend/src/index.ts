/**
 * Ponto de entrada do backend. As rotas ficam explicitamente separadas por
 * prefixo — /tuuvo/* pra Administração TUUVO, /tenant/* pra Administração
 * do Tenant — mesmo rodando no mesmo processo/porta. Essa separação de
 * prefixo é o que permite os dois frontends (admin-tuuvo/, admin-tenant/)
 * apontarem pra APIs claramente distintas sem ambiguidade.
 */
import "express-async-errors"; // Deve vir antes do express
import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { env } from "./config/env";
import { authTuuvoRouter } from "./routes/authTuuvo.routes";
import { tuuvoAdminRouter } from "./routes/tuuvoAdmin.routes";
import { authTenantRouter } from "./routes/authTenant.routes";
import { tenantRouter } from "./routes/tenant.routes";
import { conversationsRouter } from "./routes/conversations.routes";
import { webhooksRouter } from "./routes/webhooks.routes";
import { publicRouter } from "./routes/public.routes";
import { initRealtime } from "./realtime/socket";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// SDK de embed servido estático em dev (widget de chat + script de preço)
app.use(express.static(path.join(__dirname, "../../widget")));

app.get("/health", (_req, res) => res.json({ ok: true, service: "tuuvo-backend-v2" }));

// Administração TUUVO
app.use("/tuuvo/auth", authTuuvoRouter);
app.use("/tuuvo", tuuvoAdminRouter);

// Administração do Tenant
app.use("/tenant/auth", authTenantRouter);
app.use("/tenant", publicRouter);   // rotas públicas primeiro (sem auth)
app.use("/tenant", tenantRouter);   // rotas autenticadas depois

app.use("/conversations", conversationsRouter);
app.use("/webhooks", webhooksRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  
  if (err.code === '23505') {
    return res.status(400).json({ error: "Já existe um registro com estes dados (conflito único)." });
  }

  res.status(500).json({ error: "Erro interno do servidor." });
});

const server = http.createServer(app);
initRealtime(server);

server.listen(env.port, () => {
  console.log(`TUUVO backend v2 rodando na porta ${env.port}`);
});
