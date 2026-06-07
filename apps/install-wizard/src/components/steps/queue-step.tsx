'use client';

import { useState } from 'react';
import { StepCard } from '@/components/step-card';
import { StatusMessage } from '@/components/status-message';
import { apiClient, type QueueConfig, type ValidationResult } from '@/lib/api-client';

interface QueueStepProps {
  onComplete: () => void;
  onBack: () => void;
}

type QueueBackend = 'kafka' | 'rabbitmq' | 'sqs';

export function QueueStep({ onComplete, onBack }: QueueStepProps) {
  const [backend, setBackend] = useState<QueueBackend>('rabbitmq');
  const [kafkaConfig, setKafkaConfig] = useState({
    brokers: 'localhost:9092',
    clientId: 'proctira',
    groupId: 'proctira-group',
    ssl: false,
  });
  const [rabbitmqConfig, setRabbitmqConfig] = useState<{
    url: string;
    exchange: string;
    exchangeType: 'direct' | 'topic' | 'fanout' | 'headers';
  }>({
    url: 'amqp://guest:guest@localhost:5672',
    exchange: 'proctira',
    exchangeType: 'topic',
  });
  const [sqsConfig, setSqsConfig] = useState({
    region: 'us-east-1',
    queueUrlPrefix: 'https://sqs.us-east-1.amazonaws.com/123456789012/',
    accessKeyId: '',
    secretAccessKey: '',
    endpoint: '',
  });
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);

  const buildConfig = (): QueueConfig => {
    const config: QueueConfig = { backend };
    switch (backend) {
      case 'kafka':
        config.kafka = {
          brokers: kafkaConfig.brokers.split(',').map((b) => b.trim()),
          clientId: kafkaConfig.clientId,
          groupId: kafkaConfig.groupId || undefined,
          ssl: kafkaConfig.ssl,
        };
        break;
      case 'rabbitmq':
        config.rabbitmq = {
          url: rabbitmqConfig.url,
          exchange: rabbitmqConfig.exchange,
          exchangeType: rabbitmqConfig.exchangeType,
        };
        break;
      case 'sqs':
        config.sqs = {
          region: sqsConfig.region,
          queueUrlPrefix: sqsConfig.queueUrlPrefix,
          accessKeyId: sqsConfig.accessKeyId || undefined,
          secretAccessKey: sqsConfig.secretAccessKey || undefined,
          endpoint: sqsConfig.endpoint || undefined,
        };
        break;
    }
    return config;
  };

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const response = await apiClient.configureQueue(buildConfig());
      setResult(response);
      if (response.success) {
        setTimeout(onComplete, 1500);
      }
    } catch (err) {
      setResult({
        success: false,
        step: 'queue',
        message: 'Publish/consume test failed',
        error: err instanceof Error ? err.message : 'Unable to reach the install service.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <StepCard
      title="Step 4: Message Queue Configuration"
      description="Select and configure your message broker for background jobs, event streaming, and cross-service communication."
    >
      <div className="space-y-4">
        {/* Backend Selection */}
        <fieldset>
          <legend className="label">Queue Backend</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {(['sqs', 'kafka', 'rabbitmq'] as const).map((b) => (
              <label
                key={b}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-4 py-3 transition-colors has-[:checked]:border-primary-500 has-[:checked]:bg-primary-50"
              >
                <input
                  type="radio"
                  name="queue-backend"
                  value={b}
                  checked={backend === b}
                  onChange={() => { setBackend(b); setResult(null); }}
                  className="text-primary-700 focus:ring-primary-500"
                />
                <span className="text-sm font-medium">
                  {b === 'sqs' ? 'Amazon SQS' : b === 'kafka' ? 'Apache Kafka' : 'RabbitMQ'}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Kafka Config */}
        {backend === 'kafka' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="kafka-brokers" className="label">Brokers (comma-separated)</label>
              <input
                id="kafka-brokers"
                type="text"
                className="input-field"
                value={kafkaConfig.brokers}
                onChange={(e) => setKafkaConfig((prev) => ({ ...prev, brokers: e.target.value }))}
                placeholder="localhost:9092"
              />
            </div>
            <div>
              <label htmlFor="kafka-client" className="label">Client ID</label>
              <input
                id="kafka-client"
                type="text"
                className="input-field"
                value={kafkaConfig.clientId}
                onChange={(e) => setKafkaConfig((prev) => ({ ...prev, clientId: e.target.value }))}
                placeholder="proctira"
              />
            </div>
            <div>
              <label htmlFor="kafka-group" className="label">Consumer Group ID</label>
              <input
                id="kafka-group"
                type="text"
                className="input-field"
                value={kafkaConfig.groupId}
                onChange={(e) => setKafkaConfig((prev) => ({ ...prev, groupId: e.target.value }))}
                placeholder="proctira-group"
              />
            </div>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                checked={kafkaConfig.ssl}
                onChange={(e) => setKafkaConfig((prev) => ({ ...prev, ssl: e.target.checked }))}
                className="rounded border-gray-300 text-primary-700 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">Enable SSL</span>
            </label>
          </div>
        )}

        {/* RabbitMQ Config */}
        {backend === 'rabbitmq' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="rmq-url" className="label">Connection URL</label>
              <input
                id="rmq-url"
                type="text"
                className="input-field"
                value={rabbitmqConfig.url}
                onChange={(e) => setRabbitmqConfig((prev) => ({ ...prev, url: e.target.value }))}
                placeholder="amqp://guest:guest@localhost:5672"
              />
            </div>
            <div>
              <label htmlFor="rmq-exchange" className="label">Exchange Name</label>
              <input
                id="rmq-exchange"
                type="text"
                className="input-field"
                value={rabbitmqConfig.exchange}
                onChange={(e) => setRabbitmqConfig((prev) => ({ ...prev, exchange: e.target.value }))}
                placeholder="proctira"
              />
            </div>
            <div>
              <label htmlFor="rmq-type" className="label">Exchange Type</label>
              <select
                id="rmq-type"
                className="select-field"
                value={rabbitmqConfig.exchangeType}
                onChange={(e) => setRabbitmqConfig((prev) => ({ ...prev, exchangeType: e.target.value as 'direct' | 'topic' | 'fanout' | 'headers' }))}
              >
                <option value="topic">Topic</option>
                <option value="direct">Direct</option>
                <option value="fanout">Fanout</option>
                <option value="headers">Headers</option>
              </select>
            </div>
          </div>
        )}

        {/* SQS Config */}
        {backend === 'sqs' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="sqs-region" className="label">AWS Region</label>
              <input
                id="sqs-region"
                type="text"
                className="input-field"
                value={sqsConfig.region}
                onChange={(e) => setSqsConfig((prev) => ({ ...prev, region: e.target.value }))}
                placeholder="us-east-1"
              />
            </div>
            <div>
              <label htmlFor="sqs-prefix" className="label">Queue URL Prefix</label>
              <input
                id="sqs-prefix"
                type="text"
                className="input-field"
                value={sqsConfig.queueUrlPrefix}
                onChange={(e) => setSqsConfig((prev) => ({ ...prev, queueUrlPrefix: e.target.value }))}
                placeholder="https://sqs.us-east-1.amazonaws.com/..."
              />
            </div>
            <div>
              <label htmlFor="sqs-key" className="label">Access Key ID (optional)</label>
              <input
                id="sqs-key"
                type="text"
                className="input-field"
                value={sqsConfig.accessKeyId}
                onChange={(e) => setSqsConfig((prev) => ({ ...prev, accessKeyId: e.target.value }))}
                placeholder="Uses IAM role if empty"
              />
            </div>
            <div>
              <label htmlFor="sqs-secret" className="label">Secret Access Key (optional)</label>
              <input
                id="sqs-secret"
                type="password"
                className="input-field"
                value={sqsConfig.secretAccessKey}
                onChange={(e) => setSqsConfig((prev) => ({ ...prev, secretAccessKey: e.target.value }))}
                placeholder="••••••••"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="sqs-endpoint" className="label">Custom Endpoint (optional, for LocalStack)</label>
              <input
                id="sqs-endpoint"
                type="text"
                className="input-field"
                value={sqsConfig.endpoint}
                onChange={(e) => setSqsConfig((prev) => ({ ...prev, endpoint: e.target.value }))}
                placeholder="http://localhost:4566"
              />
            </div>
          </div>
        )}

        {/* Status Message */}
        {result && (
          <StatusMessage
            type={result.success ? 'success' : 'error'}
            title={result.success ? 'Publish/consume test passed' : 'Queue test failed'}
            message={result.success ? result.message : (result.error ?? result.message)}
            latencyMs={result.latencyMs}
            onRetry={result.success ? undefined : () => setResult(null)}
          />
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-2">
          <button type="button" onClick={onBack} className="btn-secondary">
            Back
          </button>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="btn-primary"
          >
            {testing ? (
              <>
                <LoadingSpinner />
                Testing Queue...
              </>
            ) : (
              'Test Publish/Consume & Continue'
            )}
          </button>
        </div>
      </div>
    </StepCard>
  );
}

function LoadingSpinner() {
  return (
    <svg className="mr-2 h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
