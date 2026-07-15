import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from '../models/user.model';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';

const SALT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  async verifyPassword(user: User, password: string): Promise<void> {
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
  }

  issueToken(user: User): { accessToken: string; expiresIn: string } {
    const payload: JwtPayload = {
      sub: user.id,
      organizationId: user.organizationId,
      isOwner: user.isOwner,
      permissions: user.role?.permissions ?? [],
    };
    const expiresIn = this.configService.get<string>('jwt.expiresIn') ?? '8h';
    return {
      accessToken: this.jwtService.sign(payload),
      expiresIn,
    };
  }
}
