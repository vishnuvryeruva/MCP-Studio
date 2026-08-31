'use strict';

// Adds the 'cap_facade' transport alongside the original direct fmcall calls.
//
// A CAP-backed destination holds no SAP backend user (the CAP app owns it) and its
// function modules are addressed by name rather than by URL, so the columns those
// two facts live in have to become nullable. Existing rows keep the direct
// behaviour via the 'direct_fmcall' default.
async function up({ sequelize, schema }) {
  const destinations = qualified(schema, 'sap_destinations');
  const functionModules = qualified(schema, 'function_modules');

  await sequelize.query(`
    ALTER TABLE ${destinations}
      ADD COLUMN IF NOT EXISTS "transport" varchar(255) NOT NULL DEFAULT 'direct_fmcall',
      ADD COLUMN IF NOT EXISTS "capExecutePath" varchar(255),
      ADD COLUMN IF NOT EXISTS "capTokenUrl" varchar(255),
      ADD COLUMN IF NOT EXISTS "capClientId" varchar(255),
      ADD COLUMN IF NOT EXISTS "encryptedCapClientSecret" text;
  `);

  await sequelize.query(`
    ALTER TABLE ${destinations}
      ALTER COLUMN "encryptedSapUser" DROP NOT NULL,
      ALTER COLUMN "encryptedSapPassword" DROP NOT NULL;
  `);

  await sequelize.query(`
    ALTER TABLE ${functionModules}
      ALTER COLUMN "fmcallUrl" DROP NOT NULL;
  `);
}

function qualified(schema, table) {
  if (!schema || schema === 'public') return `"${table}"`;
  return `"${schema}"."${table}"`;
}

module.exports = { up };
