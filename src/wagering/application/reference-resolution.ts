import type { FailureCode } from "../../shared/kernel/failure-code";
import type { WagerTransaction } from "../domain/wager-transaction";

export type ReferenceResolution =
  | { outcome: "resolved"; reference: WagerTransaction }
  | { outcome: "pending" }
  | { outcome: "rejected"; failureCode: FailureCode };
