import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { Organization } from '../models/organization.model';
import { User } from '../models/user.model';
import { Role } from '../models/role.model';
import { SapDestination } from '../models/sap-destination.model';
import { FunctionModule } from '../models/function-module.model';
import { FunctionModuleEmbedding } from '../models/function-module-embedding.model';
import { resolveDatabaseConnection, getDatabaseSchema } from './database.config';

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const schema = getDatabaseSchema();
        return {
          dialect: 'postgres',
          // On Cloud Foundry this comes from the bound postgresql-db service (with SSL);
          // locally it falls back to the DB_* env vars.
          ...resolveDatabaseConnection(config),
          models: [
            Organization,
            User,
            Role,
            SapDestination,
            FunctionModule,
            FunctionModuleEmbedding,
          ],
          autoLoadModels: true,
          synchronize: true,
          logging: false,
          // When sharing a DB with another app, keep all our tables in a dedicated
          // schema and make sure it exists before `synchronize` runs.
          ...(schema
            ? {
                define: { schema },
                hooks: {
                  afterConnect: async (connection: { query: (sql: string) => Promise<unknown> }) => {
                    await connection.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
                  },
                },
              }
            : {}),
        };
      },
    }),
  ],
})
export class DatabaseModule {}
