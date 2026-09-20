'use strict';

// Persists the XSUAA access token on CAP destinations (encrypted, with expiry)
// so chat does not mint a new token on every call. Also records which destination
// a chat thread last queried, so the Ask SAP selector can restore it.
async function up({ sequelize, schema }) {
  const destinations = qualified(schema, 'sap_destinations');
  const threads = qualified(schema, 'chat_threads');

  await sequelize.query(`
    ALTER TABLE ${destinations}
      ADD COLUMN IF NOT EXISTS "encryptedCapAccessToken" text,
      ADD COLUMN IF NOT EXISTS "capAccessTokenExpiresAt" timestamptz;
  `);

  await sequelize.query(`
    ALTER TABLE ${threads}
      ADD COLUMN IF NOT EXISTS "sapDestinationId" uuid;
  `);

  await sequelize.query(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chat_threads_sapDestinationId_fkey'
  ) THEN
    ALTER TABLE ${threads}
      ADD CONSTRAINT "chat_threads_sapDestinationId_fkey"
      FOREIGN KEY ("sapDestinationId")
      REFERENCES ${destinations} ("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
  `);
}

function qualified(schema, table) {
  if (!schema || schema === 'public') return `"${table}"`;
  return `"${schema}"."${table}"`;
}

module.exports = { up };
