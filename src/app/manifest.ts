import type { MetadataRoute } from "next";

// Lets the team add Sourcingo to a phone's home screen and open it full screen, like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sourcingo OS",
    short_name: "Sourcingo",
    description: "Orders, TNA, QC and dispatch for Sourcingo",
    start_url: "/today",
    display: "standalone",
    background_color: "#f7f7f8",
    theme_color: "#f7f7f8",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
