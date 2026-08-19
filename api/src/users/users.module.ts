import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../models/user.model';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../llm/llm.module';
import { UsersController } from './users.controller';

@Module({
  imports: [SequelizeModule.forFeature([User]), AuthModule, LlmModule],
  controllers: [UsersController],
})
export class UsersModule {}
