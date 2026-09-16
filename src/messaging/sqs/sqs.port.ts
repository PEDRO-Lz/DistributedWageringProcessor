// Port pra não deixar o SDK da AWS espalhado pelo publisher/consumer.
// os dois só conhecem essa interface, nunca @aws-sdk/client-sqs direto Igual todo
// outro port do projeto (repositórios), só que pra uma fila em vez de tabela.
export interface ReceivedSqsMessage {
  messageId: string;
  receiptHandle: string;
  body: string;
}

export interface SqsPort {
  send(
    queueName: string,
    body: string,
    messageGroupId: string,
    deduplicationId: string,
  ): Promise<void>;

  receive(
    queueName: string,
    maxMessages: number,
    waitTimeSeconds: number,
  ): Promise<ReceivedSqsMessage[]>;

  delete(queueName: string, receiptHandle: string): Promise<void>;

  // Só metadado (GetQueueUrl), nunca toca em mensagem: seguro chamar num
  // health check sem risco de "roubar" uma mensagem real da fila
  checkConnection(queueName: string): Promise<void>;
}

export const SQS_PORT = Symbol("SQS_PORT");
