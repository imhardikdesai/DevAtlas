import { Dashboard } from '@/components/layout/dashboard';
import { ToastProvider } from '@/components/ui/toast';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <ToastProvider>
      <Dashboard />
    </ToastProvider>
  );
}
