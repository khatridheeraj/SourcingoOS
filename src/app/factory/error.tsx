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
    }} />
  );
}
