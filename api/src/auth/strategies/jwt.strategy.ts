import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/sequelize';
import { User } from '../../models/user.model';
import { Role } from '../../models/role.model';
import {
  AuthenticatedUser,
  JwtPayload,
} from '../../common/interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectModel(User) private readonly userModel: typeof User,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.secret'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.userModel.findByPk(payload.sub, {
      include: [Role],
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User is inactive or no longer exists');
    }
    return {
      userId: user.id,
      organizationId: user.organizationId,
      isOwner: user.isOwner,
      permissions: user.role?.permissions ?? [],
      llmProvider: user.llmProvider,
    };
  }
}
