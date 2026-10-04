import type { World } from "@/lib/model";

// Pick-lists for the sample forms. The owner also sees real buyer names.
export function sampleOptions(w: World, keep: { vendor?: string | null } = {}) {
  return {
    buyers: w.buyers.map((b) => ({ id: b.id, label: w.isOwner && b.real_name ? `${b.code} · ${b.real_name}` : b.code })),
    vendors: w.factories.filter((f) => f.active || f.id === keep.vendor).map((f) => ({ id: f.id, label: f.city ? `${f.name} · ${f.city}` : f.name })),
    people: w.people
      .filter((p) => p.active && ["owner", "manager", "merchandiser", "qc"].includes(p.role ?? ""))
      .map((p) => ({ id: p.id, label: p.full_name || p.email })),
  };
}
