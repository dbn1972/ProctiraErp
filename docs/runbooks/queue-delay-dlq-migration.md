# Queue delay buckets and dead-letter migration (RabbitMQ, SQS)

One-off operational steps for the queue-abstraction fixes split from PR #555
(review issues #2 and #15). Run them per environment after the release that
contains `DELAY_TOPOLOGY_VERSION = 'v2'` in
`packages/shared/queue-abstraction/src/adapters/rabbitmq-adapter.ts`.

## 1. RabbitMQ: retire v1 delay buckets

### Why

v1 declared each delay bucket (`<exchange>.delay.<ms>ms`, bound on the headers
exchange `<exchange>.delay`) with `x-expires = delay + 10 min`. RabbitMQ
deletes a queue that has had no consumer, `basic.get` or re-declaration for that
long. Publishes don't count as use, and buckets have no consumers by design.
When a bucket expired, the delayed messages inside it were deleted.

Queue arguments can't be changed in place. Re-declaring an existing queue with
different arguments fails with `406 PRECONDITION_FAILED` and closes the channel.
So v2 uses new names: exchange `<exchange>.delay.v2` and queues
`<exchange>.delay.v2.<ms>ms`, declared with only `x-message-ttl` and
`x-dead-letter-exchange = <exchange>` (no `x-expires`, no
`x-dead-letter-routing-key`). Because the v2 exchange is separate, a delayed
publish is never routed into both a v1 and a v2 bucket.

### What happens on deploy

- New delayed publishes go only to v2 buckets.
- Messages already in v1 buckets still expire on their TTL and are
  dead-lettered to the work exchange with their original routing key.
- A v1 bucket that is no longer declared expires on its own about
  `delay + 10 min` after the last v1 publish. By then, all of its messages are
  past their TTL.

### Operational step (once all pods run v2)

Wait at least `max(delay) + 10 min` after the last pod running the old version
has stopped. Delays currently in use: webhook retries of up to 480 s, plus any
outbox-relayed remaining delays. Then confirm that the v1 buckets are empty and
remove whatever is left. `EX` is the configured `RABBITMQ_EXCHANGE`, which
defaults to `proctira.events`. Use `-p <vhost>` if the deployment does not use
`/`.

```bash
EX=proctira.events
# 1. List v1 buckets (names end in ms and have no .v2. segment) with depth.
rabbitmqctl list_queues name messages arguments | grep -E "^${EX}\.delay\.[0-9]+ms\s"
# 2. Each must show messages = 0. If any is non-zero, wait for its TTL and re-check.
# 3. Delete the empty v1 buckets (if-empty refuses to drop messages).
for q in $(rabbitmqctl list_queues -q name | grep -E "^${EX}\.delay\.[0-9]+ms$"); do
  rabbitmqadmin delete queue name="$q" --if-empty=true 2>/dev/null \
    || rabbitmqctl delete_queue "$q" --if-empty
done
# 4. Delete the unused v1 headers exchange.
rabbitmqadmin delete exchange name="${EX}.delay"
# 5. Verify v2 buckets carry no x-expires.
rabbitmqctl list_queues name arguments | grep -E "^${EX}\.delay\.v2\."
```

Do not delete a `*.delay.v2.*` queue. These queues hold in-flight delayed
messages and don't expire. The adapter re-declares a bucket on every delayed
publish, so a bucket deleted by mistake comes back on the next publish.
Messages that were inside it are lost.

### Dead-letter from buckets when nothing is bound (residual risk)

An expired bucket message is dead-lettered to the work exchange. This hop
isn't mandatory, so if no queue is bound for its routing key at that moment,
RabbitMQ drops it. To keep those messages, add an alternate exchange to the
work exchange with a policy. Policies apply to existing exchanges without
re-declaring them:

```bash
rabbitmqctl set_policy --apply-to exchanges proctira-work-ae "^${EX}$" \
  '{"alternate-exchange":"'"${RABBITMQ_DLX:-dlx}"'"}' --priority 10
```

Unroutable messages then land in `<dlx>.dlq`, which the adapter declares and
binds with `#` on connect. Check for conflicts with existing policies first
(`rabbitmqctl list_policies`), because only one policy applies per object.

## 2. SQS: add a redrive policy to existing queues

### Why

The adapter adds a `<queue>-dlq` (or `<queue>-dlq.fifo`) and a `RedrivePolicy`
only when it creates the queue itself (`autoCreateQueues`, off in production).
Queues that were already provisioned get no redrive policy, so poison messages
cycle until retention expires. The DLQ name can be at most 80 characters, so
main queue names can be at most 76. The adapter now refuses longer names
before creating anything, instead of creating a main queue with no DLQ.

### Operational step

Run this for each provisioned queue, then mirror it in IaC so the change isn't
reverted:

```bash
Q=<queue-name>               # e.g. tenant-<uuid>-webhook-delivery (or ...fifo)
MAX_RECEIVES=5               # match SQS maxReceiveCount config (default 5)
case "$Q" in *.fifo) DLQ="${Q%.fifo}-dlq.fifo"; FIFO_ATTR=',"FifoQueue":"true"';; *) DLQ="${Q}-dlq"; FIFO_ATTR='';; esac
[ ${#DLQ} -le 80 ] || { echo "DLQ name too long: $DLQ"; exit 1; }
aws sqs create-queue --queue-name "$DLQ" \
  --attributes '{"MessageRetentionPeriod":"1209600"'"$FIFO_ATTR"'}'
DLQ_URL=$(aws sqs get-queue-url --queue-name "$DLQ" --query QueueUrl --output text)
DLQ_ARN=$(aws sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)
Q_URL=$(aws sqs get-queue-url --queue-name "$Q" --query QueueUrl --output text)
aws sqs set-queue-attributes --queue-url "$Q_URL" --attributes \
  "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"$MAX_RECEIVES\\\"}\"}"
aws sqs get-queue-attributes --queue-url "$Q_URL" --attribute-names RedrivePolicy
```

A FIFO queue needs a FIFO DLQ, and a standard queue needs a standard DLQ.

## Rollback

- RabbitMQ: older builds publish to v1 names again, and those buckets have the
  original expiry bug. v2 buckets keep draining to the work exchange on their
  TTL. Delete them only after they are empty (`--if-empty`).
- SQS: `aws sqs set-queue-attributes --queue-url "$Q_URL" --attributes '{"RedrivePolicy":""}'`
  removes the redrive policy. The DLQ and its messages are kept.
