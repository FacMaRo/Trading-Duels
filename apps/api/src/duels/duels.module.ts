import { Module } from '@nestjs/common';
import { DuelsService } from './duels.service';
import { DuelsController } from './duels.controller';
import { DuelEngineService } from './duel-engine.service';
import { DuelsGateway } from './duels.gateway';
import { WalletModule } from '../wallet/wallet.module';
import { UsersModule } from '../users/users.module';
import { MarketModule } from '../market/market.module';
import { AuthModule } from '../auth/auth.module';
import { MissionsModule } from '../missions/missions.module';
import { SpectatorModule } from '../spectator/spectator.module';

@Module({
  imports: [
    WalletModule,
    UsersModule,
    MarketModule,
    AuthModule,
    MissionsModule,
    SpectatorModule,
  ],
  providers: [DuelsService, DuelEngineService, DuelsGateway],
  controllers: [DuelsController],
  exports: [DuelsService, DuelEngineService, DuelsGateway],
})
export class DuelsModule {}
