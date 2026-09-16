import {
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type { ReceivedSqsMessage, SqsPort } from "./sqs.port";

// URL de fila não é fixa
export class SqsClientAdapter implements SqsPort {
  private readonly client: SQSClient;
  private readonly queueUrlCache = new Map<string, string>();

  constructor() {
    const endpoint = process.env.SQS_ENDPOINT;
    this.client = new SQSClient({
      region: process.env.AWS_REGION ?? "us-east-1",
      endpoint,
      // LocalStack não valida credencial de verdade, mas o SDK exige que
      // alguma esteja presente pra montar a assinatura da requisição
      credentials: endpoint
        ? { accessKeyId: "test", secretAccessKey: "test" }
        : undefined,
    });
  }

  async send(
    queueName: string,
    body: string,
    messageGroupId: string,
    deduplicationId: string,
  ): Promise<void> {
    const queueUrl = await this.resolveQueueUrl(queueName);
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: body,
        MessageGroupId: messageGroupId,
        MessageDeduplicationId: deduplicationId,
      }),
    );
  }

  async receive(
    queueName: string,
    maxMessages: number,
    waitTimeSeconds: number,
  ): Promise<ReceivedSqsMessage[]> {
    const queueUrl = await this.resolveQueueUrl(queueName);
    const result = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: maxMessages,
        WaitTimeSeconds: waitTimeSeconds,
      }),
    );
    return (result.Messages ?? []).map((message) => ({
      messageId: message.MessageId!,
      receiptHandle: message.ReceiptHandle!,
      body: message.Body!,
    }));
  }

  async delete(queueName: string, receiptHandle: string): Promise<void> {
    const queueUrl = await this.resolveQueueUrl(queueName);
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private async resolveQueueUrl(queueName: string): Promise<string> {
    const cached = this.queueUrlCache.get(queueName);
    if (cached) {
      return cached;
    }
    const result = await this.client.send(
      new GetQueueUrlCommand({ QueueName: queueName }),
    );
    if (!result.QueueUrl) {
      throw new Error(`Fila "${queueName}" não encontrada`);
    }
    this.queueUrlCache.set(queueName, result.QueueUrl);
    return result.QueueUrl;
  }
}
