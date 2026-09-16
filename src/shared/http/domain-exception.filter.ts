import {
  Catch,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import { DomainError } from "../kernel/errors";

const STATUS_BY_CODE: Record<string, number> = {
  INVALID_MONEY_AMOUNT: HttpStatus.BAD_REQUEST,
  NEGATIVE_MONEY_AMOUNT: HttpStatus.BAD_REQUEST,
  INVALID_CURRENCY: HttpStatus.BAD_REQUEST,
  CURRENCY_MISMATCH: HttpStatus.BAD_REQUEST,
  VALIDATION_MISSING_REFERENCE: HttpStatus.BAD_REQUEST,
  VALIDATION_WALLET_PLAYER_MISMATCH: HttpStatus.BAD_REQUEST,
  VALIDATION_INVALID_CURSOR: HttpStatus.BAD_REQUEST,
  WALLET_NOT_FOUND: HttpStatus.NOT_FOUND,
  WALLET_ALREADY_EXISTS: HttpStatus.CONFLICT,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  INFRASTRUCTURE_TRANSIENT: HttpStatus.SERVICE_UNAVAILABLE,
};

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      STATUS_BY_CODE[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(exception.message, exception.stack);
    }

    response.status(status).json({
      failureCode: exception.code,
      message: exception.message,
    });
  }
}
