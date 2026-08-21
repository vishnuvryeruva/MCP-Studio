import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { FunctionModule } from '../models/function-module.model';
import { User } from '../models/user.model';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';
import { LlmModule } from '../llm/llm.module';
import { ToolIndexModule } from '../tool-index/tool-index.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [
    SequelizeModule.forFeature([FunctionModule, User]),
    AuthModule,
    // Reuses SapDestinationsService so chat calls SAP through the same
    // Cloud Connector path (and credential decryption) as Test Connection.
    AdminModule,
    LlmModule,
    // Picks which of the whitelisted tools are worth advertising per question.
    ToolIndexModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
