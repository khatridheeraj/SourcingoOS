import { getMe } from "@/lib/auth";
import { loadBuyers, loadFactories, loadTeam, personName } from "@/lib/data";

// Dropdown choices for the order form. Inactive buyers and factories still show when already on the order.
export async function formOptions(keep: { buyerId?: string; factoryIds?: string[] } = {}) {
  const [me, buyers, factories, team] = await Promise.all([getMe(), loadBuyers(), loadFactories(), loadTeam()]);
  const owner = me?.role === "owner";
  return {
    buyers: buyers
      .filter((b) => b.active || b.id === keep.buyerId)
      .map((b) => ({ id: b.id, label: owner && b.realName ? `${b.code} · ${b.realName}` : b.code })),
    factories: factories
      .filter((f) => f.active || keep.factoryIds?.includes(f.id))
      .map((f) => ({ id: f.id, label: f.city ? `${f.name} (${f.city})` : f.name })),
    team: team.filter((p) => p.active).map((p) => ({ id: p.user_id, label: personName(p) })),
    meId: me?.id ?? "",
  };
}
