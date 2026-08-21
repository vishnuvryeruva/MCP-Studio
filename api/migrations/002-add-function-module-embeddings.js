'use strict';

// Vectors for the whitelisted function modules, used to shortlist tools per
// question and to warn about near-duplicate tool descriptions.
async function up({ sequelize, schema }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS ${qualified(schema, 'function_module_embeddings')} (
      "functionModuleId" uuid PRIMARY KEY
        REFERENCES ${qualified(schema, 'function_modules')} ("id") ON DELETE CASCADE,
      "vector" jsonb NOT NULL,
      "embeddingModel" varchar(255) NOT NULL,
      "sourceHash" varchar(255) NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT NOW(),
      "updatedAt" timestamptz NOT NULL DEFAULT NOW()
    )`,
  );
}

function qualified(schema, table) {
  if (!schema || schema === 'public') return `"${table}"`;
  return `"${schema}"."${table}"`;
}

module.exports = { up };
