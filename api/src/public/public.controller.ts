import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Organization } from '../models/organization.model';
import { User } from '../models/user.model';
import { Role } from '../models/role.model';
import { AuthService } from '../auth/auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

@Controller('public/auth')
export class PublicController {
  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    @InjectModel(Organization) private readonly organizationModel: typeof Organization,
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly authService: AuthService,
  ) {}

  @Post('signup')
  async signup(@Body() dto: SignupDto) {
    const existing = await this.userModel.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const user = await this.sequelize.transaction(async (transaction) => {
      const organization = await this.organizationModel.create(
        { name: dto.organizationName },
        { transaction },
      );
      return this.userModel.create(
        {
          organizationId: organization.id,
          name: dto.name,
          email: dto.email.toLowerCase(),
          passwordHash: await this.authService.hashPassword(dto.password),
          isOwner: true,
          roleId: null,
          isActive: true,
        },
        { transaction },
      );
    });

    const { accessToken, expiresIn } = this.authService.issueToken(user);
    return {
      accessToken,
      expiresIn,
      user: toUserResponse(user),
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    const user = await this.userModel.findOne({
      where: { email: dto.email.toLowerCase() },
      include: [Role],
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }
    await this.authService.verifyPassword(user, dto.password);

    const { accessToken, expiresIn } = this.authService.issueToken(user);
    return {
      accessToken,
      expiresIn,
      user: toUserResponse(user),
    };
  }
}

function toUserResponse(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isOwner: user.isOwner,
    organizationId: user.organizationId,
    role: user.role
      ? { id: user.role.id, name: user.role.name, permissions: user.role.permissions }
      : null,
  };
}
