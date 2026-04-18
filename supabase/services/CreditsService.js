import { auth } from './AuthService.js';
import { SUPABASE_URL } from '../supabase.js';

export const INSUFFICIENT_CREDITS_MSG = "You\'ve reached your current credit limit.";
export const ACTION_NOT_ALLOWED_MSG = 'Action not allowed!';

export function getCreditsErrorMessage(reason) {
  return reason === 'no_credits' ? INSUFFICIENT_CREDITS_MSG : ACTION_NOT_ALLOWED_MSG;
}

export async function consumeCredits(action) {
  const session = await auth.getSession();
  if (!session) return { allowed: false, reason: 'no_session' };

  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/consume-credits-${action}`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "Content-Type": "application/json"
      },
    }
  );

  const data = await res.json();
  return { allowed: res.ok && data.allowed, reason: data.reason };
}