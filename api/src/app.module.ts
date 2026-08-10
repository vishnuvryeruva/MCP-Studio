import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { PublicModule } from './public/public.module';
import { AdminModule } from './admin/admin.module';
import { UsersModule } from './users/users.module';
import { LlmModule } from './llm/llm.module';
import { ChatModule } from './chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    CommonModule,
    DatabaseModule,
    AuthModule,
    PublicModule,
    AdminModule,
    UsersModule,
    LlmModule,
    ChatModule,
  ],
})
export class AppModule {}
