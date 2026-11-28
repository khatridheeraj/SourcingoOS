// A step newly marked done must come with a photo of the work (Dheeraj, 28 Nov 2026), as the factory's own updates and
// Quality's visits already do. Final QC is done by recording its check, which carries its own photos.
// was: the step as the screen loaded it; a step already done before this save needs nothing new.
export const needsProof = (r: { stage: string; done_on: string; not_needed?: boolean; was?: { done_on: string } }) =>
  !!r.done_on && !r.not_needed && !r.was?.done_on && r.stage !== "final_qc";

// Where a style's step photos are kept: the style's own folder, which the buyer's page may open.
export const proofFolder = (companyId: string, orderId: string, lineId: string) => `${companyId}/${orderId}/styles/${lineId}`;
