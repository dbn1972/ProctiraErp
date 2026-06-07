'use client';

interface StepCardProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export function StepCard({ title, description, children }: StepCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-6 border-b border-gray-100 pb-5">
        <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm text-gray-600">{description}</p>
      </div>
      {children}
    </div>
  );
}
