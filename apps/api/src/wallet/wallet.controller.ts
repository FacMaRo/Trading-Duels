import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsNumber, Min } from 'class-validator';
import type { JwtPayload } from '@trading-duels/shared';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class AmountDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;
}

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  getWallet(@CurrentUser() user: JwtPayload) {
    return this.wallet.getSnapshot(user.sub);
  }

  @Post('deposit')
  deposit(@CurrentUser() user: JwtPayload, @Body() dto: AmountDto) {
    return this.wallet.deposit(user.sub, dto.amount);
  }

  @Post('withdraw')
  withdraw(@CurrentUser() user: JwtPayload, @Body() dto: AmountDto) {
    return this.wallet.withdraw(user.sub, dto.amount);
  }
}
