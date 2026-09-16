import { IsString, Matches } from "class-validator";
import type { MoneyProps } from "../kernel/money";

export class MoneyDto implements MoneyProps {
  @IsString()
  @Matches(/^\d+\.\d{2}$/, {
    message: "amount precisa ser uma string decimal com 2 casas, ex: 25.00",
  })
  amount!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message: "currency precisa ter 3 letras maiúsculas",
  })
  currency!: string;
}
