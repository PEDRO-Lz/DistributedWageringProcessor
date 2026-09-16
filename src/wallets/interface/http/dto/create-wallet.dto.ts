import { Type } from "class-transformer";
import { IsString, ValidateNested } from "class-validator";
import { MoneyDto } from "../../../../shared/http/money.dto";

export class CreateWalletDto {
  @IsString()
  playerId!: string;

  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance!: MoneyDto;
}
