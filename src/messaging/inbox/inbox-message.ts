import { InvariantViolationError } from "../../shared/kernel/errors";

export interface ReceiveInboxMessageProps {
  consumerName: string;
  messageId: string;
  payloadHash: string;
  receivedAt: Date;
}

export interface InboxMessageState {
  consumerName: string;
  messageId: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt: Date | undefined;
}

// Dedup persistente de mensagem consumida, por (consumerName, messageId)
export class InboxMessage {
  private constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    public readonly receivedAt: Date,
    private _processedAt: Date | undefined,
  ) {}

  static receive(props: ReceiveInboxMessageProps): InboxMessage {
    return new InboxMessage(
      props.messageId,
      props.consumerName,
      props.payloadHash,
      props.receivedAt,
      undefined,
    );
  }

  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.receivedAt,
      state.processedAt,
    );
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  // MikroORM reidrata uma coluna vazia como `null`, não `undefined`,
  // mesmo a interface declarando `Date | undefined`
  // `!= null` cobre os dois de uma vez
  isProcessed(): boolean {
    return this._processedAt != null;
  }

  markProcessed(at: Date): void {
    if (this.isProcessed()) {
      throw new InvariantViolationError(
        "InboxMessage já foi marcada como processada, não pode marcar de novo",
      );
    }
    this._processedAt = at;
  }
}
