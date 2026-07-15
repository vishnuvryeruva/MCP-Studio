import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User } from '../../models/user.model';
import { Role } from '../../models/role.model';
import { AuthService } from '../../auth/auth.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Role) private readonly roleModel: typeof Role,
    private readonly authService: AuthService,
  ) {}

  findAll(organizationId: string) {
    return this.userModel.findAll({
      where: { organizationId },
      include: [Role],
      attributes: { exclude: ['passwordHash'] },
    });
  }

  private async findOneOrThrow(organizationId: string, id: string): Promise<User> {
    const user = await this.userModel.findOne({
      where: { id, organizationId },
      include: [Role],
      attributes: { exclude: ['passwordHash'] },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  private async assertRoleBelongsToOrg(organizationId: string, roleId: string) {
    const role = await this.roleModel.findOne({ where: { id: roleId, organizationId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
  }

  async create(organizationId: string, dto: CreateUserDto) {
    const existing = await this.userModel.findOne({ where: { email: dto.email.toLowerCase() } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }
    await this.assertRoleBelongsToOrg(organizationId, dto.roleId);

    const user = await this.userModel.create({
      organizationId,
      name: dto.name,
      email: dto.email.toLowerCase(),
      passwordHash: await this.authService.hashPassword(dto.password),
      roleId: dto.roleId,
      isOwner: false,
      isActive: true,
    });
    return this.findOneOrThrow(organizationId, user.id);
  }

  async update(organizationId: string, id: string, dto: UpdateUserDto) {
    const user = await this.findOneOrThrow(organizationId, id);
    if (user.isOwner) {
      throw new ForbiddenException('The organization owner cannot be modified here');
    }
    if (dto.roleId) {
      await this.assertRoleBelongsToOrg(organizationId, dto.roleId);
    }
    await user.update(dto);
    return this.findOneOrThrow(organizationId, id);
  }

  async remove(organizationId: string, id: string) {
    const user = await this.findOneOrThrow(organizationId, id);
    if (user.isOwner) {
      throw new ForbiddenException('The organization owner cannot be deleted');
    }
    await user.destroy();
  }
}
