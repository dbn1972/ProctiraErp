import { TransferWorkflowClient } from '../_components/transfer-workflow-client';

export const dynamic = 'force-dynamic';

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TransferWorkflowClient mode={{ kind: 'detail', transferId: id }} />;
}
