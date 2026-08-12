import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BR_ASSETS, BR_STAKES } from '@trading-duels/shared';

export class JoinQueueDto {
  @IsNumber()
  @IsIn([...BR_STAKES])
  stake!: number;

  @IsIn([...BR_ASSETS])
  asset!: string;

  /** Premium weekly free entry ($1 stake only) */
  @IsOptional()
  @IsBoolean()
  useFreeEntry?: boolean;

  /** Spend a free-entry credit voucher matching this stake (referral rewards) */
  @IsOptional()
  @IsBoolean()
  useFreeEntryCredit?: boolean;
}

export class TradeDto {
  @IsIn(['LONG', 'SHORT'])
  side!: 'LONG' | 'SHORT';

  @IsIn(['MARKET', 'LIMIT'])
  orderType!: 'MARKET' | 'LIMIT';

  @IsOptional()
  @IsNumber()
  @Min(0)
  entryPrice?: number;

  @IsNumber()
  @Min(0.00000001)
  stopLoss!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  takeProfit?: number | null;

  @IsNumber()
  @Min(0.01)
  @Max(2)
  riskPct!: number;
}

export class OpenTradeBody {
  @ValidateNested()
  @Type(() => TradeDto)
  trade!: TradeDto;
}

/** Edit SL / TP on an open or pending BR trade */
export class UpdateLevelsDto {
  @IsNumber()
  @Min(0.00000001)
  stopLoss!: number;

  /** null / omit to clear TP */
  @IsOptional()
  @IsNumber()
  @Min(0)
  takeProfit?: number | null;
}
