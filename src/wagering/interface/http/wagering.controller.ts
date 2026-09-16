import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { Money } from "../../../shared/kernel/money";
import { SubmitWagerTransactionUseCase } from "../../application/use-cases/submit-wager-transaction.use-case";
import { GetWagerTransactionUseCase } from "../../application/use-cases/get-wager-transaction.use-case";
import { SubmitWagerTransactionDto } from "./dto/submit-wager-transaction.dto";
import {
  toWagerTransactionView,
  type SubmitWagerTransactionView,
  type WagerTransactionView,
} from "./dto/wager-transaction.view";

@Controller("wager-transactions")
export class WageringController {
  constructor(
    @Inject(SubmitWagerTransactionUseCase)
    private readonly submit: SubmitWagerTransactionUseCase,
    @Inject(GetWagerTransactionUseCase)
    private readonly getTransaction: GetWagerTransactionUseCase,
  ) {}

  @Post()
  async submitTransaction(
    @Body() dto: SubmitWagerTransactionDto,
  ): Promise<SubmitWagerTransactionView> {
    const result = await this.submit.execute({
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      idempotencyKey: dto.idempotencyKey,
      playerId: dto.playerId,
      walletId: dto.walletId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind,
      money: Money.from(dto.money),
      referenceExternalTransactionId: dto.referenceExternalTransactionId,
    });

    return {
      transaction: toWagerTransactionView(result.transaction),
      idempotentReplay: result.idempotentReplay,
      balance: result.balance.toJSON(),
    };
  }

  @Get(":id")
  async getById(@Param("id") id: string): Promise<WagerTransactionView> {
    const tx = await this.getTransaction.byId(id);
    if (!tx) {
      throw new NotFoundException(`WagerTransaction ${id} não encontrada`);
    }
    return toWagerTransactionView(tx);
  }
}
