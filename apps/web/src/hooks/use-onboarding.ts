'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { duelsApi } from '@/lib/api';
import {
  buildChecklistSteps,
  isNewPlayer,
  loadOnboarding,
  saveOnboarding,
  type ChecklistStep,
  type OnboardingState,
} from '@/lib/onboarding';

export function useOnboarding() {
  const { user, wallet } = useAuth();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [duelCount, setDuelCount] = useState(0);
  const [ready, setReady] = useState(false);

  const userId = user?.id;

  useEffect(() => {
    if (!userId) {
      setState(null);
      setReady(false);
      return;
    }
    setState(loadOnboarding(userId));
    setReady(true);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    duelsApi
      .list()
      .then((list) => setDuelCount(list.length))
      .catch(() => setDuelCount(0));
  }, [userId]);

  const gamesPlayed = user
    ? user.wins + user.losses + user.draws
    : 0;
  const isNew = user ? isNewPlayer(user) : false;
  const available = wallet?.availableBalance ?? 0;

  const steps: ChecklistStep[] = useMemo(
    () =>
      buildChecklistSteps({
        availableBalance: available,
        duelCount,
        gamesPlayed,
      }),
    [available, duelCount, gamesPlayed],
  );

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;

  const showWelcome =
    ready &&
    !!user &&
    isNew &&
    state != null &&
    !state.welcomeSeen;

  /** Checklist solo para jugadores sin duelos completados, tras la bienvenida */
  const showChecklist =
    ready &&
    !!user &&
    isNew &&
    state != null &&
    state.welcomeSeen &&
    !state.checklistDismissed &&
    !allDone;

  const patch = useCallback(
    (p: Partial<OnboardingState>) => {
      if (!user) return;
      setState(saveOnboarding(user.id, p));
    },
    [user],
  );

  const dismissWelcome = useCallback(() => {
    patch({ welcomeSeen: true });
  }, [patch]);

  const completeWelcomeAndGo = useCallback(() => {
    patch({ welcomeSeen: true, checklistCollapsed: false });
  }, [patch]);

  const dismissChecklist = useCallback(() => {
    patch({ checklistDismissed: true });
  }, [patch]);

  const toggleChecklist = useCallback(() => {
    if (!state) return;
    patch({ checklistCollapsed: !state.checklistCollapsed });
  }, [patch, state]);

  return {
    ready,
    isNew,
    gamesPlayed,
    duelCount,
    available,
    steps,
    completedCount,
    allDone,
    showWelcome,
    showChecklist,
    checklistCollapsed: state?.checklistCollapsed ?? false,
    dismissWelcome,
    completeWelcomeAndGo,
    dismissChecklist,
    toggleChecklist,
  };
}
