import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { ALL_PERMISSIONS } from '../common/enums/permission.enum';
import { User } from '../models/user.model';
import { Role } from '../models/role.model';
import { LlmService } from '../llm/llm.service';
import { UpdateLlmProviderDto } from './dto/update-llm-provider.dto';

// Self-service endpoints for the currently logged-in account (owner or sub-user).
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly llmService: LlmService,
  ) {}

  @Get('me')
  async me(@CurrentUser() authUser: AuthenticatedUser) {
    const user = await this.userModel.findByPk(authUser.userId, { include: [Role] });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isOwner: user.isOwner,
      organizationId: user.organizationId,
      isActive: user.isActive,
      llmProvider: user.llmProvider,
      role: user.role
        ? { id: user.role.id, name: user.role.name, permissions: user.role.permissions }
        : null,
      // Owners implicitly hold every permission; sub-users are limited to their role's grants.
      permissions: user.isOwner ? ALL_PERMISSIONS : user.role?.permissions ?? [],
    };
  }

  @Get('me/llm-provider')
  async getMyLlmProvider(@CurrentUser() authUser: AuthenticatedUser) {
    const user = await this.userModel.findByPk(authUser.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return { llmProvider: user.llmProvider };
  }

  @Patch('me/llm-provider')
  async updateMyLlmProvider(
    @CurrentUser() authUser: AuthenticatedUser,
    @Body() dto: UpdateLlmProviderDto,
  ) {
    const user = await this.userModel.findByPk(authUser.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    try {
      this.llmService.resolve(dto.llmProvider);
    } catch {
      throw new BadRequestException(
        `The "${dto.llmProvider}" provider is not configured on the server.`,
      );
    }
    user.llmProvider = dto.llmProvider;
    await user.save();
    return { llmProvider: user.llmProvider };
  }
}
