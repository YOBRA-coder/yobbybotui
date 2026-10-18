// pages/ChartsPage.tsx — the same top-down workspace, bigger. 4H leads, 1H gives direction, your entry TF times the entry.
import { useIsMobile } from "../hooks/useIsMobile";
import { SignalCard, VoteCard, Workspace } from "../components/SignalPanels";

export default function ChartsPage() {
  const mobile = useIsMobile(1100);
  return (
    <div style={{ display: "grid", gridTemplateColumns: mobile ? "minmax(0,1fr)" : "minmax(0,1fr) 340px", gap: 14, alignItems: "start" }}>
      <Workspace compact={false} />
      <div style={{ display: "flex", flexDirection: "column", gap: 14, position: mobile ? "static" : "sticky", top: 70 }}><SignalCard /><VoteCard /></div>
    </div>
  );
}
