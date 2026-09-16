import {
  ChangeMessageVisibilityCommand,
  GetQueueUrlCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type { SqsPort } from "../../src/messaging/sqs/sqs.port";

export async function drainQueue(
  sqs: SqsPort,
  queueName: string,
): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const messages = await sqs.receive(queueName, 10, 0);
    if (messages.length === 0) {
      return;
    }
    for (const message of messages) {
      await sqs.delete(queueName, message.receiptHandle);
    }
  }
}

/**
 * Só existe pra teste: SqsPort nunca precisa disso
 * Zera o VisibilityTimeout de uma mensagem já recebida, forçando ela ficar
 * visível de novo imediatamente, em vez de esperar os 30s reais. Sem isso,
 * um teste de exaustão de maxReceiveCount levaria minutos de wall-clock.
 */
export async function makeMessageVisibleNow(
  queueName: string,
  receiptHandle: string,
): Promise<void> {
  const endpoint = process.env.SQS_ENDPOINT;
  const client = new SQSClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    endpoint,
    credentials: endpoint
      ? { accessKeyId: "test", secretAccessKey: "test" }
      : undefined,
  });
  const { QueueUrl } = await client.send(
    new GetQueueUrlCommand({ QueueName: queueName }),
  );
  await client.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: 0,
    }),
  );
}
