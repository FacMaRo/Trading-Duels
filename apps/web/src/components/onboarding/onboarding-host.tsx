'use client';

import { useAuth } from '@/components/providers/auth-provider';
import { useOnboarding } from '@/hooks/use-onboarding';
import { WelcomeModal } from './welcome-modal';
import { GettingStartedChecklist } from './getting-started';

/**
 * Mounts welcome modal + getting-started checklist.
 * Hooks always in the same order (no early returns before hooks).
 */
export function OnboardingHost() {
  const { user, loading } = useAuth();
  const ob = useOnboarding();

  const showHost = !loading && !!user && ob.ready;

  return (
    <>
      {showHost && ob.showWelcome && user && (
        <WelcomeModal
          username={user.displayName || user.username}
          onSkip={ob.dismissWelcome}
          onContinue={ob.completeWelcomeAndGo}
        />
      )}
      {showHost && ob.showChecklist && !ob.showWelcome && (
        <GettingStartedChecklist
          steps={ob.steps}
          completedCount={ob.completedCount}
          collapsed={ob.checklistCollapsed}
          onToggle={ob.toggleChecklist}
          onDismiss={ob.dismissChecklist}
        />
      )}
    </>
  );
}
