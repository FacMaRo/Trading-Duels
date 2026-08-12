import { Module } from '@nestjs/common';
import { MatchmakingService } from './matchmaking.service';
import { MatchmakingController } from './matchmaking.controller';
import { MatchmakingGateway } from './matchmaking.gateway';
import { DuelsModule } from '../duels/duels.module';
import { WalletModule } from '../wallet/wallet.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DuelsModule, WalletModule, AuthModule],
  providers: [MatchmakingService, MatchmakingGateway],
  controllers: [MatchmakingController],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
