import { getMe } from "@/lib/auth";
import { buyerName, loadBuyers, loadFactories, loadTeam, personName } from "@/lib/data";

// Dropdown choices for the order form. Inactive buyers and factories still show when already on the order.
// Merchandiser choices are the people who run orders; buyer and factory logins, Quality and Accounts never are.
const RUNS_ORDERS = ["owner", "manager", "merchandiser"];

export async function formOptions(keep: { buyerId?: string; factoryIds?: string[]; merchandiserId?: string } = {}) {
  const [me, buyers, factories, team] = await Promise.all([getMe(), loadBuyers(), loadFactories(), loadTeam()]);
  return {
    buyers: buyers
      .filter((b) => b.active || b.id === keep.buyerId)
      .map((b) => ({ id: b.id, label: buyerName(b), code: b.code })),
    factories: factories
      .filter((f) => f.active || keep.factoryIds?.includes(f.id))
      .map((f) => ({ id: f.id, label: f.city ? `${f.name} (${f.city})` : f.name, name: f.name, phone: f.phone })),
    team: team.filter((p) => (p.active && RUNS_ORDERS.includes(p.role)) || p.user_id === keep.merchandiserId).map((p) => ({ id: p.user_id, label: personName(p) })),
    meId: me?.id ?? "",
  };
}
