// Sign-in by email link: what to tell someone when it didn't go through, and the wait before asking again.

// Seconds before another link can be asked for. Supabase refuses a second link to the same address inside 60 s.
export const RESEND_WAIT = 60;

export type Refusal = { text: string; wait: number };

// Supabase's own wording for a sign-in it refused, in plain words, with how long to wait before "Send again".
// Never "an hour": nobody on the team should be told to come back later.
export function refusal(message: string): Refusal {
  const wait = message.match(/after (\d+) seconds?/i);
  if (wait) return { text: "A link was just sent. Open the newest sign-in email, or send another when the timer ends.", wait: Number(wait[1]) };
  if (/rate limit|too many/i.test(message)) {
    return {
      text: "Sign-in emails are busy for a moment. If you already have a sign-in email, open its newest link on this device. Otherwise send again when the timer ends.",
      wait: RESEND_WAIT,
    };
  }
  if (/signups not allowed|not allowed for otp/i.test(message)) return { text: "This email isn't on the team yet. Ask the owner to add you.", wait: 0 };
  if (/fetch|network/i.test(message)) return { text: "No internet connection. Check it and try again.", wait: 0 };
  return { text: message, wait: 0 };
}

// "sourcingo.com", "sourcing.in", "sorucingo.in": a near miss of our own address, which would send the link nowhere.
// Returns the address they most likely meant, or null.
export function likelyTypo(email: string): string | null {
  const m = email.trim().toLowerCase().match(/^([^@\s]+)@([^@\s]+)$/);
  if (!m) return null;
  const [, user, domain] = m;
  if (domain === "sourcingo.in") return null;
  const name = domain.split(".")[0];
  if (name === "sourcingo" || distance(name, "sourcingo") <= 2) return `${user}@sourcingo.in`;
  return null;
}

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}
