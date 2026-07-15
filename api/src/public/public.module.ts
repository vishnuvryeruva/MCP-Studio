import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Organization } from '../models/organization.model';
import { User } from '../models/user.model';
import { AuthModule } from '../auth/auth.module';
import { PublicController } from './public.controller';

@Module({
  imports: [SequelizeModule.forFeature([Organization, User]), AuthModule],
  controllers: [PublicController],
})
export class PublicModule {}
