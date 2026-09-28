import { TransferWorkflowClient } from './_components/transfer-workflow-client';

export const dynamic = 'force-dynamic';

export default function TransfersPage() {
  return <TransferWorkflowClient mode={{ kind: 'list' }} />;
}
