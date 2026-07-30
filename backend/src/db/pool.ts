/**
 * Pool de conexão com o Postgres.
 *
 * Ponto de customização: `withTenantContext` é o único jeito "certo" de rodar
 * uma query que deve respeitar o isolamento de tenant (RLS, ver db/schema.sql).
 * Se você ver uma query nova em alguma rota chamando `pool.query(...)`
 * diretamente sem passar por `withTenantContext`, é sinal de alerta — só é
 * aceitável pras tabelas de nível plataforma (tuuvo_users, planos, tenants,
 * faturamento_mensal, platform_channel_providers), que não têm RLS de tenant.
 */
import { Pool, PoolClient } from "pg";
import { env } from "../config/env";

export const pool = new Pool({ connectionString: env.databaseUrl });

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
