'use strict';

const fs = require('fs');
const path = require('path');
const { Sequelize, QueryTypes } = require('sequelize');

async function main() {
  const schema = getDbSchema();
  const connection = resolveConnection();
  const sequelize = new Sequelize({
    dialect: 'postgres',
    logging: false,
    ...connection,
  });

  try {
    await sequelize.authenticate();
    if (schema && schema !== 'public') {
      await sequelize.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    }
    await ensureMigrationsTable(sequelize, schema);
    const applied = await readAppliedMigrations(sequelize, schema);
    const files = listMigrationFiles();

    for (const file of files) {
      if (applied.has(file)) continue;
      const migration = require(path.join(__dirname, file));
      if (typeof migration.up !== 'function') {
        throw new Error(`Migration "${file}" does not export an up() function`);
      }
      console.log(`Applying migration: ${file}`);
      await migration.up({ sequelize, schema });
      await sequelize.query(
        `INSERT INTO ${qualified(schema, 'schema_migrations')} ("name") VALUES (:name)`,
        { replacements: { name: file } },
      );
    }

    console.log('Migrations complete.');
  } finally {
    await sequelize.close();
  }
}

function listMigrationFiles() {
  return fs
    .readdirSync(__dirname)
    .filter((f) => /^\d+.*\.js$/.test(f) && f !== 'run.js')
    .sort();
}

async function ensureMigrationsTable(sequelize, schema) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS ${qualified(schema, 'schema_migrations')} (
      "name" varchar(255) PRIMARY KEY,
      "appliedAt" timestamptz NOT NULL DEFAULT NOW()
    )`,
  );
}

async function readAppliedMigrations(sequelize, schema) {
  const rows = await sequelize.query(
    `SELECT "name" FROM ${qualified(schema, 'schema_migrations')}`,
    { type: QueryTypes.SELECT },
  );
  return new Set(rows.map((row) => row.name));
}

function qualified(schema, table) {
  if (!schema || schema === 'public') return `"${table}"`;
  return `"${schema}"."${table}"`;
}

function getDbSchema() {
  const value = (process.env.DB_SCHEMA || '').trim();
  return value || 'public';
}

function resolveConnection() {
  const bound = readBoundPostgres();
  if (bound) {
    const ca = bound.sslrootcert || bound.sslcert;
    return {
      host: bound.hostname,
      port: Number(bound.port),
      username: bound.username,
      password: bound.password,
      database: bound.dbname,
      dialectOptions: {
        ssl: ca
          ? { require: true, rejectUnauthorized: true, ca }
          : { require: true, rejectUnauthorized: false },
      },
    };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'mygo_fm_bridge',
  };
}

function readBoundPostgres() {
  if (!process.env.VCAP_SERVICES) return null;
  try {
    const parsed = JSON.parse(process.env.VCAP_SERVICES);
    const binding = parsed['postgresql-db'] && parsed['postgresql-db'][0];
    return (binding && binding.credentials) || null;
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
