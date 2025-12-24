import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(loginDto: { username: string; password: string }) {
    const { username, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { username },
      include: {
        campus: true,
        userRoles: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
      },
    });

    if (!user) throw new UnauthorizedException('用户名或密码错误');
    if (user.status !== 1) throw new UnauthorizedException('账号已被禁用');

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) throw new UnauthorizedException('用户名或密码错误');

    const roles = user.userRoles.map((ur) => ur.role.code);
    const permissions = [...new Set(
      user.userRoles.flatMap((ur) =>
        ur.role.permissions.map((rp) => rp.permission.code),
      ),
    )];

    const payload = {
      userId: user.id,
      username: user.username,
      realName: user.realName,
      campusId: user.campusId,
      roles,
      permissions,
    };

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      accessToken: this.jwtService.sign(payload),
      user: { ...payload, campusName: user.campus?.name },
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        campus: true,
        userRoles: { include: { role: true } },
      },
    });

    if (!user) throw new UnauthorizedException('用户不存在');

    const { password, ...safeUser } = user;
    return safeUser;
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }
}

