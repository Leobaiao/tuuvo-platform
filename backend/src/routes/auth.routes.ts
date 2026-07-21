import { Router } from "express";
import { z } from "zod";
import { login } from "../services/auth.service";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(6),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const { token, user } = await login(parsed.data.email, parsed.data.senha);
    res.json({ token, user });
  } catch {
    res.status(401).json({ error: "Credenciais inválidas" });
  }
});
