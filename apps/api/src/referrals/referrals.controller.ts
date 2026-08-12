import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { JwtPayload } from '@trading-duels/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { ReferralsService } from './referrals.service';

@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  /** Authenticated overview: code, link path, invites, free-entry credits */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.referrals.getOverview(user.sub);
  }

  /** Public resolve of a referral code (for register page banner) */
  @Public()
  @Get('code/:code')
  byCode(@Param('code') code: string) {
    return this.referrals.findReferrerByCode(code);
  }
}
