import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
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
  listProviders() {
    return this.llmService.listProviders();
  }

  @Get('tools')
  listTools(@CurrentUser() user: AuthenticatedUser) {
    return this.chatService.listAvailableTools(user.organizationId);
  }

  @Post('message')
  @HttpCode(HttpStatus.OK)
  message(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChatMessageDto) {
    return this.chatService.handleTurn({
      organizationId: user.organizationId,
      message: dto.message,
      history: dto.history ?? [],
    });
  }
}
