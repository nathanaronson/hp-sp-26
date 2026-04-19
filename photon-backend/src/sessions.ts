/**
 * In-memory mapping of phone number → deployment ID.
 *
 * When a user texts in, we look up which CLI deployment they're linked to
 * so we can route their message to the right sandbox terminal.
 *
 * Phone numbers are normalized to E.164-ish form (digits only, with a
 * leading "+" if present) so "+1 925 804 5085", "(925) 804-5085", and
 * "+19258045085" all map to the same key.
 *
 * Call `POST /api/link-session` to create a mapping.
 */

const sessions = new Map<string, string>();

export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
}

export function linkSession(phone: string, deploymentId: string): void {
  const key = normalizePhone(phone);
  sessions.set(key, deploymentId);
  console.log(`[sessions] linked ${key} -> ${deploymentId}`);
}

export function getDeploymentForSender(senderId: string): string | undefined {
  const key = normalizePhone(senderId);
  const result = sessions.get(key);
  if (!result) {
    console.log(
      `[sessions] no link for ${key} (have: ${[...sessions.keys()].join(", ") || "(empty)"})`,
    );
  }
  return result;
}

export function unlinkSession(phone: string): void {
  const key = normalizePhone(phone);
  sessions.delete(key);
  console.log(`[sessions] unlinked ${key}`);
}
