import { ConfigService } from '@nestjs/config';

export interface DatabaseConnectionOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  dialectOptions?: Record<string, unknown>;
}

interface PostgresBindingCredentials {
  hostname: string;
  port: string | number;
  username: string;
  password: string;
  dbname: string;
  sslrootcert?: string;
  sslcert?: string;
}

// On Cloud Foundry the bound `postgresql-db` service provides its credentials via
// VCAP_SERVICES (and requires SSL). Locally there's no VCAP_SERVICES, so we fall
// back to the discrete DB_* env vars from configuration.ts.
export function resolveDatabaseConnection(
  config: ConfigService,
): DatabaseConnectionOptions {
  const bound = readBoundPostgres();
  if (bound) {
    const ca = bound.sslrootcert ?? bound.sslcert;
    return {
      host: bound.hostname,
      port: Number(bound.port),
      username: bound.username,
      password: bound.password,
      database: bound.dbname,
      // BTP Postgres mandates TLS. Pin the CA the broker hands us when present.
      dialectOptions: {
        ssl: ca
          ? { require: true, rejectUnauthorized: true, ca }
          : { require: true, rejectUnauthorized: false },
      },
    };
  }

  return {
    host: config.get<string>('database.host')!,
    port: config.get<number>('database.port')!,
    username: config.get<string>('database.username')!,
    password: config.get<string>('database.password')!,
    database: config.get<string>('database.database')!,
  };
}

function readBoundPostgres(): PostgresBindingCredentials | null {
  const vcap = process.env.VCAP_SERVICES;
  if (!vcap) {
    return null;
  }
  try {
    const parsed = JSON.parse(vcap) as Record<
      string,
      Array<{ credentials?: PostgresBindingCredentials }>
    >;
    // The service instances are keyed by offering name ("postgresql-db").
    const binding = parsed['postgresql-db']?.[0];
    return binding?.credentials ?? null;
  } catch {
    // Malformed VCAP_SERVICES — fall back to env vars rather than crash.
    return null;
  }
}
