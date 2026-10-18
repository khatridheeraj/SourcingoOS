import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const body = Inter({ variable: "--font-body", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono-face", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Sourcingo OS",
  description: "Inquiries, sales orders, TNA and warehouse for Sourcingo",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
