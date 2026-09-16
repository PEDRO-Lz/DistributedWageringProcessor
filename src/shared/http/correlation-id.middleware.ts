import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { newId } from "../kernel/id";
import { runWithLogContext } from "../logging/log-context";

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers["x-correlation-id"];
    const correlationId = typeof header === "string" ? header : newId();
    res.setHeader("x-correlation-id", correlationId);
    runWithLogContext({ correlationId }, next);
  }
}
