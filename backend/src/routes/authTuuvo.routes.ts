import { Router } from "express";
import { z } from "zod";
import { loginTuuvo } from "../services/authTuuvo.service";

export const authTuuvoRouter = Router();

const loginSchema = z.object({ email: z.string().email(), senha: z.string().min(6) });

authTuuvoRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const { token, user } = await loginTuuvo(parsed.data.email, parsed.data.senha);
    res.json({ token, user });
  } catch {
    res.status(401).json({ error: "Credenciais inválidas" });
  }
});
