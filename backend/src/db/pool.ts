import { Pool, PoolClient } from "pg";
import { env } from "../config/env";

export const pool = new Pool({ connectionString: env.databaseUrl });

/**
 * Executa `fn` dentro de uma transação com o contexto de tenant já definido
 * via `SET LOCAL app.current_tenant`, que as policies de RLS do schema.sql
 * usam para filtrar automaticamente todas as tabelas.
 *
 * tenantId = null + superadmin = true => enxerga todos os tenants.
 */
export async function withTenantContext<T>(
  tenantId: string | null,
  isSuperadmin: boolean,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.is_superadmin', $1, true)", [
      String(isSuperadmin),
    ]);
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [
      tenantId ?? "",
    ]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
