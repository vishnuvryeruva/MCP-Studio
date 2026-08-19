'use strict';

async function up({ sequelize, schema }) {
  const queryInterface = sequelize.getQueryInterface();
  const tableName = schema ? { tableName: 'users', schema } : 'users';
  const schemaName = schema && schema.trim() ? schema : 'public';

  await sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'enum_users_llmProvider'
      AND n.nspname = '${schemaName}'
  ) THEN
    CREATE TYPE ${qualifiedType(schemaName)} AS ENUM ('anthropic', 'openai', 'gemini');
  END IF;
END $$;`);

  const table = await queryInterface.describeTable(tableName);
  if (!table.llmProvider) {
    await sequelize.query(
      `ALTER TABLE ${qualifiedUsersTable(schema)}
       ADD COLUMN "llmProvider" ${qualifiedType(schemaName)} NOT NULL DEFAULT 'anthropic';`,
    );
  }
}

function qualifiedUsersTable(schema) {
  if (!schema || schema === 'public') return '"users"';
  return `"${schema}"."users"`;
}

function qualifiedType(schema) {
  if (!schema || schema === 'public') return '"enum_users_llmProvider"';
  return `"${schema}"."enum_users_llmProvider"`;
}

module.exports = { up };
