import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { ALL_PERMISSIONS } from '../common/enums/permission.enum';
import { User } from '../models/user.model';
import { Role } from '../models/role.model';

// Self-service endpoints for the currently logged-in account (owner or sub-user).
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(@InjectModel(User) private readonly userModel: typeof User) {}

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
      role: user.role
        ? { id: user.role.id, name: user.role.name, permissions: user.role.permissions }
        : null,
      // Owners implicitly hold every permission; sub-users are limited to their role's grants.
      permissions: user.isOwner ? ALL_PERMISSIONS : user.role?.permissions ?? [],
    };
  }
}
