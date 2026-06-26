import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Brain } from 'lucide-react';
import { Spinner } from '@/components/ui/Spinner';
import { mneme } from '@/lib/mneme';
import { RecallTester } from '@/components/mneme/RecallTester';
import { StrengthPanel } from '@/components/mneme/StrengthPanel';
import { MemoryFeed } from '@/components/mneme/MemoryFeed';
import { ModesPanel } from '@/components/mneme/ModesPanel';
import { SourcesPanel } from '@/components/mneme/SourcesPanel';
import { KnowledgeProfilePanel } from '@/components/mneme/KnowledgeProfilePanel';
import { LearningQueuePanel } from '@/components/mneme/LearningQueuePanel';
import { ObservingStatus } from '@/components/mneme/ObservingStatus';
import { Onboarding } from '@/components/mneme/Onboarding';

/**
 * Mneme Control Center — the human's window into their own memory: what Mneme
 * kept, how strong each memory is, what it's allowed to observe, and how it
 * shows up. Plus a live recall surface to feel the loop.
 */
export default function ControlCenter() {
  const { data: memories = [], isLoading } = useQuery({
    queryKey: ['mneme', 'memories'],
    queryFn: () => mneme.listMemories(200),
    staleTime: 10_000,
  });

  // First-run cold-start: show onboarding once until completed. Derive the
  // open state (no effect) — a local "dismissed" flag lets the user close it.
  const { data: onboarding } = useQuery({
    queryKey: ['mneme', 'onboarding'],
    queryFn: mneme.getOnboarding,
    staleTime: 60_000,
  });
  const [dismissed, setDismissed] = useState(false);
  const showOnboarding = !dismissed && onboarding?.onboarded === false;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-dim)]">
          <Brain size={16} className="text-[var(--accent)]" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Control Center</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            Learn what matters. Remember what lasts.
          </p>
        </div>
      </div>

      <ObservingStatus />

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Main column */}
          <div className="lg:col-span-2 space-y-5">
            <RecallTester />
            <StrengthPanel memories={memories} />
            <LearningQueuePanel />
            <MemoryFeed memories={memories} />
          </div>

          {/* Controls column */}
          <div className="space-y-5">
            <KnowledgeProfilePanel />
            <ModesPanel />
            <SourcesPanel />
          </div>
        </div>
      )}

      <Onboarding open={showOnboarding} onClose={() => setDismissed(true)} />
    </div>
  );
}
