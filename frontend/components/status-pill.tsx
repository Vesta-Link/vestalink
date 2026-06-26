"use client";

import { usePreferences } from "@/components/preferences-provider";
import type { StreamView } from "@/lib/vesting";

export function StatusPill({ status }: { status: StreamView["status"] }) {
  const { t } = usePreferences();
  return <span className={`status-pill ${status}`}>{t.status[status]}</span>;
}
