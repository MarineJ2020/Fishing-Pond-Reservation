// Pegs another customer is holding while they pay (server: holdPegs in
// functions/src/booking-service.js). Shown as taken to everyone but the holder.
export interface PegHold {
  competitionId: string;
  /** sha256(uid) hex, first 16 chars — matches holderKey() on the server. */
  holder: string;
  pondSelections: { pondId: number; seats: number[] }[];
}

export const holderKeyFor = async (uid: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
};

/** `${pondId}-${seat}` keys held by others in this competition. */
export const heldPegKeys = (holds: PegHold[] | undefined, competitionId: string, myHolder: string | null): string[] =>
  (holds || [])
    .filter((hold) => hold.competitionId === competitionId && hold.holder !== myHolder)
    .flatMap((hold) => hold.pondSelections.flatMap((selection) => selection.seats.map((seat) => `${selection.pondId}-${seat}`)));
