"use client";

/**
 * useDigestBriefing — a scheduled, once-per-session analyst briefing.
 *
 * ~45s after boot (enough time for a pitch narrative to build up),
 * the engine "compiles" a pattern digest and slides in an intel-violet
 * toast with the live numbers and a one-click "Open brief" action.
 * Skipped when the analyst already opened the digest themselves or
 * when the engine is offline — never noise, only theatre.
 */

import { useEffect } from "react";
import { ToastAction } from "@/components/ui/toast";
import { useAppStore } from "@/store/appStore";
import { useToast } from "@/hooks/use-toast";
import { formatINR, formatNumber } from "@/lib/format";

const BRIEFING_DELAY_MS = 45_000;
const BRIEFING_VISIBLE_MS = 12_000;

export function useDigestBriefing() {
  const { toast } = useToast();

  useEffect(() => {
    const timer = setTimeout(() => {
      const s = useAppStore.getState();
      if (s.digestToastShown || s.digestOpen) return;
      if (s.connection === "offline" || s.loading) return;

      const open = s.transactions.filter(
        (t) =>
          (t.riskLevel === "HIGH" ||
            t.riskLevel === "CRITICAL" ||
            t.status === "INVESTIGATING" ||
            t.status === "UNDER_REVIEW") &&
          !s.decisions[t.id],
      );
      if (open.length === 0) return;

      const exposure = open.reduce((sum, t) => sum + t.amount, 0);
      const hottest = [...open].sort((a, b) => b.riskScore - a.riskScore)[0];

      s.markDigestToastShown();
      toast({
        variant: "intel",
        title: "Pattern digest compiled",
        description: `${open.length} open cases · ${formatINR(exposure)} under scrutiny across a ${formatNumber(s.transactions.length)}-transaction window.${hottest ? ` Hottest: ${hottest.id} at ${hottest.riskScore}/100.` : ""}`,
        duration: BRIEFING_VISIBLE_MS,
        action: (
          <ToastAction
            altText="Open the pattern digest brief"
            onClick={() => useAppStore.getState().setDigestOpen(true)}
          >
            Open brief
          </ToastAction>
        ),
      });
    }, BRIEFING_DELAY_MS);

    return () => clearTimeout(timer);
  }, [toast]);
}
