"use client";

import { PageError } from "@/components/page-error";

// In Hindi and English together: the language cookie isn't readable here.
export default function FactoryError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <PageError error={error} retry={retry} home="/factory" words={{
      title: "पेज नहीं खुला · This page couldn't load",
      body: "आपका भेजा हुआ काम सुरक्षित है। फिर से कोशिश करें। · Nothing you sent is lost. Try again.",
      retry: "फिर से कोशिश करें · Try again",
      home: "शुरुआत पर जाएं · Start",
    }} offline={{
      title: "इंटरनेट कट गया · The connection dropped",
      body: "शायद आखिरी काम नहीं गया। इंटरनेट आने पर फिर से कोशिश करें और देख लें। · What you just tapped may not have saved. When the network is back, tap Try again and check it.",
    }} signedOut={{
      title: "आप लॉगआउट हो गए · You were signed out",
      body: "आखिरी काम नहीं गया। अपना फैक्ट्री लिंक फिर से खोलें। · What you just tapped didn't save. Open your factory link again to sign in.",
      signIn: "फिर से लॉगिन करें · Sign in again",
    }} />
  );
}
