import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { ChatService } from './chat.service';
import { LlmService } from '../llm/llm.service';
import { ChatMessageDto } from './dto/chat-message.dto';

// End-user surface: any authenticated account in the organization can chat.
// Tools are scoped to that organization's enabled function modules.
@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly llmService: LlmService,
  ) {}

  @Get('providers')
  listProviders(@CurrentUser() user: AuthenticatedUser) {
    return this.llmService.listProviders(user.llmProvider);
  }

  @Get('tools')
  listTools(@CurrentUser() user: AuthenticatedUser) {
    return this.chatService.listAvailableTools(user.organizationId);
  }

  @Get('threads')
  listThreads(@CurrentUser() user: AuthenticatedUser) {
    return this.chatService.listThreads(user.userId, user.organizationId);
  }

  @Get('threads/:threadId')
  getThread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('threadId', new ParseUUIDPipe({ version: '4' })) threadId: string,
  ) {
    return this.chatService.getThread(threadId, user.userId, user.organizationId);
  }

  @Post('threads')
  @HttpCode(HttpStatus.CREATED)
  createThread(@CurrentUser() user: AuthenticatedUser) {
    return this.chatService.createThread(user.userId, user.organizationId);
  }

  @Delete('threads/:threadId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteThread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('threadId', new ParseUUIDPipe({ version: '4' })) threadId: string,
  ) {
    await this.chatService.deleteThread(threadId, user.userId, user.organizationId);
  }

  @Post('message')
  @HttpCode(HttpStatus.OK)
  message(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChatMessageDto) {
    return this.chatService.handleTurn({
      userId: user.userId,
      organizationId: user.organizationId,
      threadId: dto.threadId,
      message: dto.message,
    });
  }
}
