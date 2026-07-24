import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';
import { Organization } from '../models/organization.model';
import { User } from '../models/user.model';
import { Role } from '../models/role.model';
import { SapDestination } from '../models/sap-destination.model';
import { FunctionModule } from '../models/function-module.model';
import { resolveDatabaseConnection } from './database.config';

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        dialect: 'postgres',
        // On Cloud Foundry this comes from the bound postgresql-db service (with SSL);
        // locally it falls back to the DB_* env vars.
        ...resolveDatabaseConnection(config),
        models: [Organization, User, Role, SapDestination, FunctionModule],
        autoLoadModels: true,
        synchronize: true,
        logging: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
