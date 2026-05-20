import type { StreamView } from "@/lib/vesting";

const labels: Record<StreamView["status"], string> = {
  pending: "Pending",
  active: "Active",
  complete: "Complete",
  revoked: "Revoked"
};

export function StatusPill({ status }: { status: StreamView["status"] }) {
  return <span className={`status-pill ${status}`}>{labels[status]}</span>;
}
