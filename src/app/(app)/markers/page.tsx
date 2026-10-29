import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { MARKER_PHOTOS_ON } from "@/lib/features";

// MarkerPilot: fabric consumption and CAD markers from garment photos. The tool itself is one page
// (public/markerpilot/index.html, built by markerpilot/build-page.cjs); it saves styles and reads photos through /api/markers.
export default async function MarkersPage() {
  const me = await getMe();
  if (!canEditOrders(me?.role)) redirect("/");
  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Markers</h1>
          <p>Fabric consumption and the most efficient cutting marker, from photos of the garment. Saved styles are shared with the team.</p>
        </div>
        <a className="btn" href="/markerpilot/index.html" target="_blank" rel="noopener">Open full screen</a>
      </div>
      {!MARKER_PHOTOS_ON && (
        <div className="empty">
          <b>Photo reading is off for now</b>
          The Claude AI account has no credit, so photos cannot be read. Tap Set up this style by hand instead, then enter the garment, fabrics and measurements yourself. Everything else works and saved styles are kept.
        </div>
      )}
      <iframe className="marker-frame" src="/markerpilot/index.html" title="MarkerPilot" allow="clipboard-write" />
    </>
  );
}
