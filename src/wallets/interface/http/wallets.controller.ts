import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { Money } from "../../../shared/kernel/money";
import { WalletNotFoundError } from "../../../shared/kernel/errors";
import { OpenWalletUseCase } from "../../application/use-cases/open-wallet.use-case";
import { GetWalletUseCase } from "../../application/use-cases/get-wallet.use-case";
import { GetWalletLedgerUseCase } from "../../application/use-cases/get-wallet-ledger.use-case";
import { ReconcileWalletUseCase } from "../../application/use-cases/reconcile-wallet.use-case";
import { CreateWalletDto } from "./dto/create-wallet.dto";
import { toWalletView, type WalletView } from "./dto/wallet.view";
import {
  toWalletLedgerPageView,
  type WalletLedgerPageView,
} from "./dto/wallet-ledger.view";
import {
  toReconciliationView,
  type ReconciliationView,
} from "./dto/reconciliation.view";

@Controller("wallets")
export class WalletsController {
  constructor(
    @Inject(OpenWalletUseCase) private readonly openWallet: OpenWalletUseCase,
    @Inject(GetWalletUseCase) private readonly getWallet: GetWalletUseCase,
    @Inject(GetWalletLedgerUseCase)
    private readonly getLedger: GetWalletLedgerUseCase,
    @Inject(ReconcileWalletUseCase)
    private readonly reconcile: ReconcileWalletUseCase,
  ) {}

  @Post()
  async open(@Body() dto: CreateWalletDto): Promise<WalletView> {
    const wallet = await this.openWallet.execute({
      playerId: dto.playerId,
      initialBalance: Money.from(dto.initialBalance),
    });
    return toWalletView(wallet);
  }

  @Get(":id")
  async getById(@Param("id") id: string): Promise<WalletView> {
    const wallet = await this.getWallet.execute(id);
    if (!wallet) {
      throw new WalletNotFoundError(id);
    }
    return toWalletView(wallet);
  }

  @Get(":id/ledger")
  async getLedgerPage(
    @Param("id") id: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<WalletLedgerPageView> {
    const page = await this.getLedger.execute({
      walletId: id,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
    return toWalletLedgerPageView(page);
  }

  @Get(":id/reconciliation")
  async getReconciliation(
    @Param("id") id: string,
  ): Promise<ReconciliationView> {
    const result = await this.reconcile.execute(id);
    return toReconciliationView(result);
  }
}
