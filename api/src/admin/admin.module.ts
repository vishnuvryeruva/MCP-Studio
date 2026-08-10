import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../models/user.model';
import { Role } from '../models/role.model';
import { SapDestination } from '../models/sap-destination.model';
import { FunctionModule as FunctionModuleModel } from '../models/function-module.model';
import { AuthModule } from '../auth/auth.module';
import { RolesController } from './controllers/roles.controller';
import { UsersController } from './controllers/users.controller';
import { SapDestinationsController } from './controllers/sap-destinations.controller';
import { FunctionModulesController } from './controllers/function-modules.controller';
import { RolesService } from './services/roles.service';
import { UsersService } from './services/users.service';
import { SapDestinationsService } from './services/sap-destinations.service';
import { FunctionModulesService } from './services/function-modules.service';
import { ServiceDiscoveryService } from './services/service-discovery.service';

@Module({
  imports: [
    SequelizeModule.forFeature([User, Role, SapDestination, FunctionModuleModel]),
    AuthModule,
  ],
  controllers: [
    RolesController,
    UsersController,
    SapDestinationsController,
    FunctionModulesController,
  ],
  providers: [
    RolesService,
    UsersService,
    SapDestinationsService,
    FunctionModulesService,
    ServiceDiscoveryService,
  ],
  // Chat reuses the SAP caller so fmcall invocations go through the same
  // Cloud Connector routing and credential decryption as the admin screens.
  exports: [SapDestinationsService],
})
export class AdminModule {}
