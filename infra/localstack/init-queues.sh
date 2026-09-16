#!/usr/bin/env bash
# Roda dentro do container do LocalStack (hook de init), depois que os
# serviços simulados já estão de pé. `awslocal` é o `aws` do próprio
# LocalStack, já apontado pro endpoint certo
set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-us-east-1}"

DLQ_URL=$(awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true \
  --region "$REGION" \
  --query QueueUrl --output text)

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url "$DLQ_URL" \
  --attribute-names QueueArn \
  --region "$REGION" \
  --query Attributes.QueueArn --output text)

# maxReceiveCount=5: depois de 5 entregas sem ack, a mensagem vai pra DLQ
# em vez de ficar reentregue pra sempre.
REDRIVE_POLICY="{\"deadLetterTargetArn\":\"$DLQ_ARN\",\"maxReceiveCount\":\"5\"}"
ESCAPED_REDRIVE_POLICY=$(printf '%s' "$REDRIVE_POLICY" | sed 's/"/\\"/g')

awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes "{\"FifoQueue\":\"true\",\"ContentBasedDeduplication\":\"true\",\"RedrivePolicy\":\"$ESCAPED_REDRIVE_POLICY\"}" \
  --region "$REGION"

awslocal sqs create-queue \
  --queue-name wager-events.fifo \
  --attributes FifoQueue=true,ContentBasedDeduplication=true \
  --region "$REGION"

echo "Filas prontas: wager-transactions.fifo (+ DLQ), wager-events.fifo"
