'use client';

interface StepCardProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export function StepCard({ title, description, children }: StepCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm text-gray-600">{description}</p>
      </div>
      {children}
    </div>
  );
}
