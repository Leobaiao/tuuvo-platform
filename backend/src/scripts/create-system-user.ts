import { pool } from "../db/pool";
import bcrypt from "bcryptjs";
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query: string): Promise<string> => new Promise(resolve => rl.question(query, resolve));

async function main() {
  console.log("=== Criação de Usuário Padrão do Sistema (TUUVO Admin) ===");
  
  const email = await question("E-mail [superadmin@tuuvo.app.br]: ") || "superadmin@tuuvo.app.br";
  const nome = await question("Nome [Superadmin]: ") || "Superadmin";
  const senha = await question("Senha [123456]: ") || "123456";
  const papel = await question("Papel (superadmin/operador) [superadmin]: ") || "superadmin";

  const senha_hash = await bcrypt.hash(senha, 10);

  try {
    const result = await pool.query(
      `INSERT INTO tuuvo_users (email, senha_hash, nome, papel) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (email) 
       DO UPDATE SET senha_hash = EXCLUDED.senha_hash, nome = EXCLUDED.nome, papel = EXCLUDED.papel
       RETURNING id, email, nome, papel;`,
      [email, senha_hash, nome, papel]
    );

    console.log("Usuário criado/atualizado com sucesso!");
    console.log(result.rows[0]);
  } catch (error) {
    console.error("Erro ao criar usuário:", error);
  } finally {
    pool.end();
    rl.close();
  }
}

main();
