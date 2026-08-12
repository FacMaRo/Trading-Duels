import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import type { JwtPayload } from '@trading-duels/shared';
import { INITIAL_ELO } from '@trading-duels/shared';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { ReferralsService } from '../referrals/referrals.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly wallet: WalletService,
    private readonly referrals: ReferralsService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Sesión DEMO: solo nickname, sin email/password/depósito.
   * Crea un user isDemoGuest + wallet vacía + JWT.
   */
  async createDemoSession(nicknameRaw: string) {
    const nick = nicknameRaw
      .trim()
      .replace(/[^a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ]/g, '')
      .slice(0, 16);
    if (nick.length < 2) {
      throw new BadRequestException(
        'Nickname: mínimo 2 caracteres (letras, números, _)',
      );
    }

    let username = nick;
    // Evitar colisión con users reales
    const base = nick.toLowerCase();
    let candidate = base;
    let i = 0;
    while (await this.users.findByUsername(candidate)) {
      i += 1;
      candidate = `${base}${i}`.slice(0, 24);
      if (i > 50) {
        candidate = `d_${randomBytes(4).toString('hex')}`;
        break;
      }
    }
    username = candidate;

    const email = `demo_${randomBytes(8).toString('hex')}@demo.local`;
    const passwordHash = await bcrypt.hash(randomBytes(16).toString('hex'), 8);

    const user = await this.users.create({
      email,
      username,
      displayName: nick,
      passwordHash,
      elo: INITIAL_ELO,
      isDemoGuest: true,
    });
    await this.wallet.createForUser(user.id);

    const tokens = await this.signTokens(user);
    return {
      user: this.users.toPublic(user),
      ...tokens,
    };
  }

  async register(dto: RegisterDto) {
    const existingEmail = await this.users.findByEmail(dto.email);
    if (existingEmail) {
      throw new ConflictException('El email ya está registrado');
    }
    const existingUsername = await this.users.findByUsername(dto.username);
    if (existingUsername) {
      throw new ConflictException('El username ya está en uso');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const referralCode = await this.referrals.generateUniqueCode();
    const user = await this.users.create({
      email: dto.email.toLowerCase().trim(),
      username: dto.username.trim(),
      displayName: dto.displayName?.trim() || dto.username.trim(),
      passwordHash,
      elo: INITIAL_ELO,
      referralCode,
    });

    await this.wallet.createForUser(user.id);

    // Attach referral relationship if invite code provided
    if (dto.referralCode?.trim()) {
      await this.referrals.attachOnSignup(user.id, dto.referralCode);
    }

    const tokens = await this.signTokens(user);
    return {
      user: this.users.toPublic(user),
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.users.findByEmail(dto.email.toLowerCase().trim());
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const tokens = await this.signTokens(user);
    return {
      user: this.users.toPublic(user),
      ...tokens,
    };
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    const wallet = await this.wallet.getByUserId(userId);
    return {
      user: this.users.toPublic(user),
      wallet: wallet
        ? {
            balance: Number(wallet.balance),
            lockedBalance: Number(wallet.lockedBalance),
            availableBalance:
              Number(wallet.balance) - Number(wallet.lockedBalance),
          }
        : null,
    };
  }

  private async signTokens(user: {
    id: string;
    email: string;
    username: string;
    role: string;
  }) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role as JwtPayload['role'],
    };
    const accessToken = await this.jwt.signAsync(payload);
    return {
      accessToken,
      expiresIn: '7d',
    };
  }
}
