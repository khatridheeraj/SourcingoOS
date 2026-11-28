"use client";

import { useState, useTransition } from "react";
import { setEveningEmail } from "./actions";

export function EveningSwitch({ on }: { on: boolean }) {
  const [value, setValue] = useState(on);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <label className="bell-switch">
      <span className="grow">
        <b>Evening email</b>
        <small>At 7 pm, Monday to Saturday: what changed today and the steps due tomorrow. Nothing is sent on a quiet day.</small>
        {error && <small className="text-bad">{error}</small>}
      </span>
      <input type="checkbox" role="switch" checked={value} disabled={pending} aria-label="Evening email"
        onChange={(e) => {
          const next = e.target.checked;
          setValue(next);
          setError("");
          start(async () => {
            const res = await setEveningEmail(next);
            if (res.error) { setValue(!next); setError(res.error); }
          });
        }} />
    </label>
  );
}
