import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import { env } from "./config/env";
import { authRouter } from "./routes/auth.routes";
import { superadminRouter } from "./routes/superadmin.routes";
import { tenantRouter } from "./routes/tenant.routes";
import { conversationsRouter } from "./routes/conversations.routes";
import { webhooksRouter } from "./routes/webhooks.routes";
import { publicRouter } from "./routes/public.routes";
import { initRealtime } from "./realtime/socket";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Serve o SDK de embed direto do backend em dev — em produção isso normalmente
// vira um CDN próprio (ver seção 9: "https://cdn.tuuvo.app.br/widget.js").
app.use(express.static(path.join(__dirname, "../../widget")));

app.get("/health", (_req, res) => res.json({ ok: true, service: "tuuvo-backend" }));

app.use("/auth", authRouter);
app.use("/superadmin", superadminRouter);
app.use("/tenant", publicRouter); // rotas públicas (sem auth) primeiro
app.use("/tenant", tenantRouter); // rotas autenticadas do painel
app.use("/conversations", conversationsRouter);
app.use("/webhooks", webhooksRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno" });
});

const server = http.createServer(app);
initRealtime(server);

server.listen(env.port, () => {
  console.log(`TUUVO backend rodando na porta ${env.port}`);
});
