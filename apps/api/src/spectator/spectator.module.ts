import { Module } from '@nestjs/common';
import { SpectatorBetsService } from './spectator-bets.service';
import { SpectatorController } from './spectator.controller';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  providers: [SpectatorBetsService],
  controllers: [SpectatorController],
  exports: [SpectatorBetsService],
})
export class SpectatorModule {}
