import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  RANK_TIERS,
  type JwtPayload,
  type LeaderboardModeFilter,
} from '@trading-duels/shared';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class SetPremiumDto {
  @IsBoolean()
  isPremium!: boolean;
}

class LeaderboardQuery {
  @IsOptional()
  @IsIn(['GLOBAL', 'BLITZ', 'NORMAL', 'SLOW'])
  mode?: LeaderboardModeFilter = 'GLOBAL';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Public()
  @Get('leaderboard')
  leaderboard(@Query() query: LeaderboardQuery) {
    return this.users.getLeaderboard(
      query.mode ?? 'GLOBAL',
      query.limit ?? 50,
      query.offset ?? 0,
    );
  }

  @Public()
  @Get('profile/:username')
  getProfileByUsername(@Param('username') username: string) {
    return this.users.getPublicProfile(username);
  }

  @Public()
  @Get('users/by-username/:username')
  getByUsername(@Param('username') username: string) {
    return this.users.getPublicProfile(username);
  }

  @Public()
  @Get('users/:id')
  async getById(@Param('id') id: string) {
    const byId = await this.users.findById(id);
    if (byId) {
      return this.users.getPublicProfile(byId.username);
    }
    return this.users.getPublicProfile(id);
  }

  @Public()
  @Get('ranks')
  ranks() {
    return { tiers: RANK_TIERS };
  }

  /**
   * Dev toggle Premium (sin pasarela).
   * POST body: { isPremium: true|false }
   */
  @Patch('users/me/premium')
  setMyPremium(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetPremiumDto,
  ) {
    return this.users.setPremium(user.sub, dto.isPremium);
  }
}
