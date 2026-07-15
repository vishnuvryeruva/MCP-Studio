import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Role } from '../../models/role.model';
import { User } from '../../models/user.model';
import { CreateRoleDto } from '../dto/create-role.dto';
import { UpdateRoleDto } from '../dto/update-role.dto';

@Injectable()
export class RolesService {
  constructor(
    @InjectModel(Role) private readonly roleModel: typeof Role,
    @InjectModel(User) private readonly userModel: typeof User,
  ) {}

  findAll(organizationId: string) {
    return this.roleModel.findAll({ where: { organizationId } });
  }

  async findOneOrThrow(organizationId: string, id: string): Promise<Role> {
    const role = await this.roleModel.findOne({ where: { id, organizationId } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return role;
  }

  async create(organizationId: string, dto: CreateRoleDto) {
    const existing = await this.roleModel.findOne({
      where: { organizationId, name: dto.name },
    });
    if (existing) {
      throw new ConflictException('A role with this name already exists');
    }
    return this.roleModel.create({ ...dto, organizationId });
  }

  async update(organizationId: string, id: string, dto: UpdateRoleDto) {
    const role = await this.findOneOrThrow(organizationId, id);
    return role.update(dto);
  }

  async remove(organizationId: string, id: string) {
    const role = await this.findOneOrThrow(organizationId, id);
    const usersWithRole = await this.userModel.count({ where: { roleId: id } });
    if (usersWithRole > 0) {
      throw new ConflictException(
        'Cannot delete a role that is still assigned to users',
      );
    }
    await role.destroy();
  }
}
