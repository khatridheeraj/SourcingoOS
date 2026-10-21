import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { MARKERS_ON } from "@/lib/features";

// MarkerPilot: fabric consumption and CAD markers from garment photos. The tool itself is one page
// (public/markerpilot/index.html, built by markerpilot/build-page.cjs); it saves styles and reads photos through /api/markers.
export default async function MarkersPage() {
  const me = await getMe();
  if (!canEditOrders(me?.role)) redirect("/");
  if (!MARKERS_ON) {
    return (
      <>
        <div className="head"><div className="grow"><h1>Markers</h1></div></div>
        <div className="empty">
          <b>Markers is paused</b>
          It reads garment photos with Claude AI, and the AI account has no credit, so every reading failed. It comes back on the menu as soon as credit is added. Your saved styles are kept.
        </div>
      </>
    );
  }
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Markers</h1>
          <p>Fabric consumption and the most efficient cutting marker, from photos of the garment. Saved styles are shared with the team.</p>
        </div>
        <a className="btn" href="/markerpilot/index.html" target="_blank" rel="noopener">Open full screen</a>
      </div>
      <iframe className="marker-frame" src="/markerpilot/index.html" title="MarkerPilot" allow="clipboard-write" />
    </>
  );
}
