'use strict';

async function up({ sequelize, schema }) {
  const queryInterface = sequelize.getQueryInterface();
  const tableName = schema ? { tableName: 'users', schema } : 'users';

  await sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_users_llmProvider') THEN
    CREATE TYPE "enum_users_llmProvider" AS ENUM ('anthropic', 'openai', 'gemini');
  END IF;
END $$;`);

  const table = await queryInterface.describeTable(tableName);
  if (!table.llmProvider) {
    await sequelize.query(
      `ALTER TABLE ${qualifiedUsersTable(schema)}
       ADD COLUMN "llmProvider" "enum_users_llmProvider" NOT NULL DEFAULT 'anthropic';`,
    );
  }
}

function qualifiedUsersTable(schema) {
  if (!schema || schema === 'public') return '"users"';
  return `"${schema}"."users"`;
}

module.exports = { up };
