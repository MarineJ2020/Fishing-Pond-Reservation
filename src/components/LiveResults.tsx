import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Competition, Score, ScoreEntry, Pond, Booking, User, DB } from '../types';
import { formatWeight } from '../utils/weight';
import type { Settings } from '../types';
import { getLB, getPrize, p2, formatDate } from '../utils';
import { getCompetitionPhase, isCompetitionEnded } from '../utils/competition';
import { formatSeat } from '../utils/seatLabel';
import { collection, query, where, onSnapshot, doc, getDocs } from 'firebase/firestore';
import { db as firestoreDb } from '../../lib/firebase';

interface LiveResultsProps {
  decimalPlaces: Settings['ocrDecimalPlaces'];
  comp: Competition;
  competitions: Competition[];
  scores: Record<number, Score>;
  ponds: Pond[];
  bookings: Booking[];
  availability: DB['availability'];
  user: User | null;
}

const fmtLongDate = (iso?: string): string => formatDate(iso, { weekday: true });

// Format a Firestore Timestamp / ISO string into a short Malay time, e.g. "9:45 malam".
const fmtTime = (value: any): string => {
  if (!value) return '';
  let d: Date;
  if (typeof value === 'string') d = new Date(value);
  else if (typeof value?.toDate === 'function') d = value.toDate();
  else if (typeof value?.seconds === 'number') d = new Date(value.seconds * 1000);
  else return '';
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h < 12 ? 'pagi' : h < 15 ? 'tengahari' : h < 19 ? 'petang' : 'malam';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
};

const defaultCompetitionId = (competitions: Competition[], fallback: Competition): string => {
  const live = getLiveCompetitions(competitions, fallback)[0];
  return live?.id || '';
};

const getLiveCompetitions = (competitions: Competition[], fallback?: Competition): Competition[] => {
  const seen = new Set<string>();
  return [...competitions, ...(fallback ? [fallback] : [])].filter((competition) => {
    if (!competition.id || seen.has(competition.id)) return false;
    seen.add(competition.id);
    return getCompetitionPhase(competition) === 'live';
  });
};

const LiveResults: React.FC<LiveResultsProps> = ({ comp, competitions, ponds, bookings, availability, user, decimalPlaces }) => {
  const [selectedCompId, setSelectedCompId] = useState(() => defaultCompetitionId(competitions, comp));
  const [liveScores, setLiveScores] = useState<ScoreEntry[]>([]);
  const [loadingScores, setLoadingScores] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [cdBlocks, setCdBlocks] = useState({ d: '--', h: '--', m: '--', s: '--' });
  const [cdStatus, setCdStatus] = useState<'upcoming' | 'live' | 'ended'>('upcoming');
  const [topN, setTopN] = useState(comp.topN || 20);
  const [pegSearch, setPegSearch] = useState('');

  // Past-event results
  const [selectedPastId, setSelectedPastId] = useState('');
  const [pastScores, setPastScores] = useState<ScoreEntry[]>([]);
  const [pastLoading, setPastLoading] = useState(false);
  const liveCompetitions = useMemo(() => getLiveCompetitions(competitions, comp), [competitions, comp]);

  // When data first arrives or the selected event changes phase, choose the
  // currently live event. Upcoming and ended events must not drive this page.
  useEffect(() => {
    if (selectedCompId && liveCompetitions.some((competition) => competition.id === selectedCompId)) return;
    const nextComp = liveCompetitions[0] || null;
    const nextId = nextComp?.id || '';
    setSelectedCompId(nextId);
    if (nextComp) setTopN(nextComp.topN || 20);
  }, [cdStatus, liveCompetitions, selectedCompId]);

  // Real-time score listener — fires on every score write without polling
  const scoreMapRef = useRef<Map<string, ScoreEntry>>(new Map());
  useEffect(() => {
    if (!selectedCompId) return;
    setLoadingScores(true);
    scoreMapRef.current = new Map();

    const resultsRef = collection(firestoreDb, 'eventResults');
    const flush = () => {
      const entries = Array.from(scoreMapRef.current.values());
      setLiveScores(entries);
      setLastUpdated(new Date().toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setLoadingScores(false);
    };

    // Two listeners: one for string competitionId, one for document-reference competitionId
    const unsubStr = onSnapshot(
      query(resultsRef, where('competitionId', '==', selectedCompId)),
      (snap) => {
        snap.docs.forEach(d => scoreMapRef.current.set(d.id, { id: d.id, ...(d.data() as Omit<ScoreEntry, 'id'>) }));
        snap.docChanges().filter(c => c.type === 'removed').forEach(c => scoreMapRef.current.delete(c.doc.id));
        flush();
      }
    );
    const unsubRef = onSnapshot(
      query(resultsRef, where('competitionId', '==', doc(firestoreDb, 'competitions', selectedCompId))),
      (snap) => {
        snap.docs.forEach(d => scoreMapRef.current.set(d.id, { id: d.id, ...(d.data() as Omit<ScoreEntry, 'id'>) }));
        snap.docChanges().filter(c => c.type === 'removed').forEach(c => scoreMapRef.current.delete(c.doc.id));
        flush();
      }
    );

    return () => { unsubStr(); unsubRef(); };
  }, [selectedCompId]);

  const displayComp = liveCompetitions.find(c => c.id === selectedCompId) || liveCompetitions[0] || comp;

  // Countdown for displayComp
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const start = new Date(displayComp.startDate).getTime();
      const end = new Date(displayComp.endDate).getTime();
      let target: number, status: 'upcoming' | 'live' | 'ended';
      if (now < start) { target = start; status = 'upcoming'; }
      else if (now < end) { target = end; status = 'live'; }
      else { status = 'ended'; target = end; }
      setCdStatus(status);
      if (status !== 'ended') {
        const diff = Math.max(0, target - now);
        setCdBlocks({
          d: p2(Math.floor(diff / 86400000)),
          h: p2(Math.floor((diff % 86400000) / 3600000)),
          m: p2(Math.floor((diff % 3600000) / 60000)),
          s: p2(Math.floor((diff % 60000) / 1000))
        });
      }
    };
    tick();
    const int = setInterval(tick, 1000);
    return () => clearInterval(int);
  }, [displayComp]);

  // Build scores record from live entries
  const scoresRecord: Record<number, Score> = {};
  const timeByPeg: Record<number, string> = {};
  liveScores.forEach(e => {
    scoresRecord[e.seatNum] = { weight: e.weight, anglerName: e.anglerName, pondId: e.pondId, pondName: e.pondName };
    timeByPeg[e.seatNum] = fmtTime((e as any).updatedAt || (e as any).createdAt);
  });

  const fullLb = getLB(scoresRecord);
  const pegSearchTerm = pegSearch.trim().toLowerCase();
  const rankedLb = fullLb.map((entry, index) => ({ ...entry, rank: index + 1 }));
  const lb = (pegSearchTerm
    ? rankedLb.filter((entry) => {
        const pond = ponds.find(p => p.id === entry.pondId);
        const formattedSeat = pond?.code ? formatSeat(pond.code, entry.peg).toLowerCase() : '';
        return entry.peg.toString().includes(pegSearchTerm)
          || formattedSeat.includes(pegSearchTerm)
          || `peg #${entry.peg}`.includes(pegSearchTerm);
      })
    : rankedLb.slice(0, topN));

  const displayBookings = bookings.filter(b => (b.competitionId || comp.id) === selectedCompId);
  const bookingRefByPeg = useMemo(() => {
    const map: Record<number, string> = {};
    displayBookings
      .filter((b) => b.status === 'confirmed')
      .forEach((b) => {
        (b.seats || []).forEach((seat) => {
          map[seat] = b.bookingRef || b.id.slice(0, 8).toUpperCase();
        });
      });
    return map;
  }, [displayBookings]);
  const userPegs = user ? displayBookings.filter(b => (b.userId === user.uid || b.userId === user.email || b.userEmail === user.email) && b.status === 'confirmed').flatMap(b => b.pondSelections?.length ? b.pondSelections.flatMap(s => s.seats) : b.seats) : [];

  // User's rank across the FULL leaderboard (not just Top-N), so participants who
  // placed outside the Top-N can still be pinned at the bottom.
  let myEntry: { peg: number; name: string; weight: number; pondId: number } | null = null;
  let myRank = -1; // 1-based
  userPegs.forEach(peg => {
    const idx = fullLb.findIndex(e => e.peg === peg);
    if (idx !== -1 && (myRank === -1 || idx + 1 < myRank)) { myRank = idx + 1; myEntry = fullLb[idx]; }
  });
  const isMeInTopN = myRank > 0 && myRank <= topN;

  // ── Past results (ended competitions) ───────────────────────────────────
  const endedComps = useMemo(
    () => competitions.filter(c => c.id && isCompetitionEnded(c)),
    [competitions],
  );
  const endedKey = endedComps.map(c => c.id).join(',');

  useEffect(() => {
    if (!selectedPastId && endedComps.length) setSelectedPastId(endedComps[0].id || '');
  }, [endedKey, selectedPastId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedPastId) { setPastScores([]); return; }
    let cancelled = false;
    setPastLoading(true);
    const resultsRef = collection(firestoreDb, 'eventResults');
    (async () => {
      const map = new Map<string, ScoreEntry>();
      try {
        const [s1, s2] = await Promise.all([
          getDocs(query(resultsRef, where('competitionId', '==', selectedPastId))),
          getDocs(query(resultsRef, where('competitionId', '==', doc(firestoreDb, 'competitions', selectedPastId)))),
        ]);
        s1.docs.forEach(d => map.set(d.id, { id: d.id, ...(d.data() as Omit<ScoreEntry, 'id'>) }));
        s2.docs.forEach(d => map.set(d.id, { id: d.id, ...(d.data() as Omit<ScoreEntry, 'id'>) }));
      } catch { /* ignore fetch errors — show empty state */ }
      if (!cancelled) { setPastScores(Array.from(map.values())); setPastLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedPastId]);

  const selectedPastComp = competitions.find(c => c.id === selectedPastId) || null;
  const pastScoresRecord: Record<number, Score> = {};
  pastScores.forEach(e => {
    pastScoresRecord[e.seatNum] = { weight: e.weight, anglerName: e.anglerName, pondId: e.pondId, pondName: e.pondName };
  });
  const pastLb = getLB(pastScoresRecord);
  const pastWinners = pastLb.slice(0, selectedPastComp?.topN || 10);
  const pastParticipants = availability.filter(b => b.competitionId === selectedPastId && b.status === 'confirmed')
    .reduce((total, b) => total + (b.pondSelections?.reduce((count, s) => count + s.seats.length, 0) || b.seats.length), 0);
  const pastPonds = selectedPastComp?.activePondIds?.length || 0;
  const pastChampWeight = pastLb[0]?.weight;
  const pastChampPrize = selectedPastComp ? getPrize(1, selectedPastComp.prizes) : '';

  const statusLabel = cdStatus === 'upcoming' ? 'Akan Datang' : cdStatus === 'live' ? 'Live' : 'Tamat';
  const cdLabel = cdStatus === 'upcoming' ? 'Bermula dalam' : cdStatus === 'live' ? 'Tamat dalam' : 'Status Event';
  const hasOngoingEvent = cdStatus === 'live';

  return (
    <div className="kl-page">
      {/* HERO */}
      <section className="kl-hero">
        <div className="kl-hero-inner">
          <div className="kl-hero-copy">
            <div className="kl-eyebrow">Live Ranking</div>
            <h1>Keputusan <span>Langsung</span></h1>
            <p>Semak kedudukan semasa, rekod tangkapan terkini dan keputusan peserta sepanjang pertandingan berlangsung.</p>
          </div>
          {hasOngoingEvent && <aside className={`kl-live-box ${cdStatus}`}>
            <div className="kl-live-head">
              <div>
                <small>Live Event</small>
                <strong>{displayComp.name}</strong>
              </div>
              <div className={`kl-live-pill ${cdStatus}`}><span></span> {statusLabel}</div>
            </div>
            <div className="kl-cd">
              <div className="kl-cd-label">{cdLabel}</div>
              <div className="kl-cd-grid">
                <div className="kl-cd-item"><strong>{cdBlocks.d}</strong><small>Hari</small></div>
                <div className="kl-cd-item"><strong>{cdBlocks.h}</strong><small>Jam</small></div>
                <div className="kl-cd-item"><strong>{cdBlocks.m}</strong><small>Minit</small></div>
                <div className="kl-cd-item"><strong>{cdBlocks.s}</strong><small>Saat</small></div>
              </div>
            </div>
          </aside>}
        </div>
      </section>

      {/* Competition selector — only currently live competitions, and only
          shown at all when there's more than one to choose between. */}
      {(() => {
        if (liveCompetitions.length <= 1) return null;
        return (
          <div className="kl-comp-tabs">
            {liveCompetitions.map(c => (
              <button
                key={c.id || c.name}
                type="button"
                className={`kl-comp-tab ${selectedCompId === c.id ? 'active' : ''}`}
                onClick={() => { setSelectedCompId(c.id || ''); setTopN(c.topN || 20); }}
              >
                {c.name}
              </button>
            ))}
          </div>
        );
      })()}

      {/* DASHBOARD */}
      {hasOngoingEvent && <section className="kl-dash">
        <div className="kl-dash-grid">
          {/* Ranking panel */}
          <section className="kl-panel">
            <div className="kl-panel-head">
              <div>
                <div className="kl-eyebrow">{displayComp.name}</div>
                <h2>Kedudukan Terkini</h2>
              </div>
              <span className={`kl-status-pill ${cdStatus}`}>
                <span className="dot"></span> {cdStatus === 'live' ? 'LANGSUNG' : statusLabel}
              </span>
            </div>

            <div className="kl-rank-tools">
              <span className="kl-topn-badge">Top {topN}</span>
              <div className="kl-topn-ctl">
                Tunjuk
                <input
                  type="number"
                  value={topN}
                  min={1}
                  max={500}
                  onChange={(e) => setTopN(parseInt(e.target.value) || 20)}
                />
                Teratas
              </div>
              <label className="kl-peg-search">
                <span>No Pancang</span>
                <input
                  type="search"
                  value={pegSearch}
                  placeholder="Cari..."
                  onChange={(e) => setPegSearch(e.target.value)}
                />
              </label>
              <span className="kl-last-upd">
                {loadingScores ? 'Memuatkan…' : lastUpdated ? `Dikemaskini ${lastUpdated}` : ''}
              </span>
            </div>

            <div className="kl-rank-scroll">
              <div className="kl-rank-list">
                {lb.length ? lb.map((e) => {
                  const rank = e.rank;
                  const isMe = userPegs.includes(e.peg);
                  const pond = ponds.find(p => p.id === e.pondId);
                  const pondName = pond ? pond.name.split('—')[0].trim() : '';
                  const time = timeByPeg[e.peg];
                  return (
                    <article key={e.peg} className={`kl-rank-row ${rank === 1 ? 'champ' : ''} ${isMe ? 'me' : ''}`}>
                      <div className="kl-rank-no">{p2(rank)}</div>
                      <div className="kl-angler">
                        <strong>{e.name}{isMe ? ' · Anda' : ''}</strong>
                        <span>{pond?.code ? formatSeat(pond.code, e.peg) : `Peg #${e.peg}${pondName ? ` · ${pondName}` : ''}`}</span>
                        {bookingRefByPeg[e.peg] && <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>Ref: {bookingRefByPeg[e.peg]}</span>}
                      </div>
                      <div className="kl-weight">
                        <small>Berat</small>
                        <strong>{formatWeight(e.weight, decimalPlaces)}kg</strong>
                      </div>
                      <div className="kl-updated">
                        <i className="fa-solid fa-clock"></i> {time || '—'}
                      </div>
                    </article>
                  );
                }) : (
                  <div className="kl-no-data">
                    <i className="fa-solid fa-fish-fins"></i>{' '}
                    {loadingScores ? 'Memuatkan data…' : pegSearchTerm ? 'Tiada rekod untuk No Pancang ini.' : 'Tiada rekod berat lagi — sila semak semula semasa pertandingan!'}
                  </div>
                )}
              </div>
            </div>

            {/* Pinned my-result bar — always shown for logged-in users. Shows a
                placeholder until their weight has been recorded. */}
            {user && (
              <div className={`kl-myresult ${myEntry ? '' : 'empty'}`}>
                <div className="kl-myresult-user">
                  <small>Keputusan Saya</small>
                  <strong>{user.name}</strong>
                </div>
                {myEntry ? (
                  <>
                    <div className="kl-mini">
                      <small>Berat</small>
                      <strong>{formatWeight((myEntry as { weight: number }).weight, decimalPlaces)}kg</strong>
                    </div>
                    <div className="kl-mini rank">
                      <small>Rank</small>
                      <strong>#{myRank}</strong>
                    </div>
                  </>
                ) : (
                  <div className="kl-myresult-empty">
                    Berat &amp; kedudukan anda akan dipaparkan di sini sebaik sahaja timbangan direkodkan.
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Prize list */}
          <aside className="kl-side">
            <section className="kl-panel">
              <div className="kl-panel-head">
                <div>
                  <div className="kl-eyebrow">Senarai Hadiah</div>
                  <h3>Hadiah Event</h3>
                </div>
              </div>
              <div className="kl-prize-list">
                {displayComp.prizes?.length ? displayComp.prizes.map((prize, i) => (
                  <div key={i} className="kl-prize-item">
                    <div className="kl-prize-place">
                      <i className={`fa-solid fa-${i === 0 ? 'trophy' : i === 1 ? 'medal' : i === 2 ? 'award' : 'gift'}`}></i>
                      {prize.label || `Tempat ${prize.rank}`}
                    </div>
                    <div className="kl-prize-amount">{prize.prize}</div>
                  </div>
                )) : (
                  <div className="kl-no-data" style={{ padding: '24px' }}>Hadiah belum ditetapkan.</div>
                )}
              </div>
            </section>
          </aside>
        </div>
      </section>}

      {/* PAST RESULTS */}
      {endedComps.length > 0 && <section className="kl-past">
        <div className="kl-past-head">
          <div>
            <div className="kl-eyebrow">Keputusan Event Lepas</div>
            <h2 className="kl-h2">Senarai <span>Pemenang</span></h2>
          </div>
          <p>Pilih event di sebelah kiri untuk lihat keputusan penuh. Keputusan dikira automatik daripada berat akhir yang direkodkan.</p>
        </div>

        <div className="kl-past-layout">
            <div className="kl-past-left">
              <section className="kl-card">
                <div className="kl-card-head">
                  <div className="kl-eyebrow">ACARA LEPAS</div>
                  <h3>PILIH ACARA LEPAS</h3>
                </div>
                <div className="kl-event-select">
                  {endedComps.map(c => (
                    <button
                      key={c.id || c.name}
                      type="button"
                      className={`kl-past-event ${selectedPastId === c.id ? 'active' : ''}`}
                      onClick={() => setSelectedPastId(c.id || '')}
                    >
                      <span>
                        <strong>{c.name}</strong>
                        <small>{fmtLongDate(c.startDate)}</small>
                      </span>
                      <i className="fa-solid fa-chevron-right"></i>
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <section className="kl-winner-table">
              <div className="kl-selected-head">
                <div>
                  <h3>{selectedPastComp?.name || '—'}</h3>
                  <p>
                    {fmtLongDate(selectedPastComp?.startDate)}
                    {pastParticipants ? ` · ${pastParticipants} Peserta` : ''}
                    {pastPonds ? ` · ${pastPonds} Kolam` : ''}
                  </p>
                </div>
                <span className="kl-selected-badge"><i className="fa-solid fa-circle-check"></i> KEPUTUSAN DITERBITKAN</span>
              </div>

              <div className="kl-winner-summary">
                <div className="kl-winner-summary-item"><small>Juara</small><strong>{pastWinners[0]?.name || '—'}</strong></div>
                <div className="kl-winner-summary-item"><small>Berat Terberat</small><strong>{pastChampWeight != null ? `${formatWeight(pastChampWeight, decimalPlaces)}KG` : '—'}</strong></div>
                <div className="kl-winner-summary-item"><small>Hadiah Utama</small><strong>{pastChampPrize || '—'}</strong></div>
              </div>

              <div className="kl-table-head">
                <div>Kedudukan</div><div>Peserta</div><div>Berat</div><div>Hadiah</div>
              </div>
              {pastLoading ? (
                <div className="kl-no-data">Memuatkan keputusan…</div>
              ) : pastWinners.length ? pastWinners.map((e, i) => {
                const rank = i + 1;
                const prize = selectedPastComp ? getPrize(rank, selectedPastComp.prizes) : '';
                const pond = ponds.find(p => p.id === e.pondId);
                const pondName = pond ? pond.name.split('—')[0].trim() : '';
                return (
                  <div key={e.peg} className="kl-winner-row">
                    <div><span className="kl-winner-rank">{p2(rank)}</span></div>
                    <div><strong>{e.name}</strong><br /><span>{pond?.code ? formatSeat(pond.code, e.peg) : `Peg #${e.peg}${pondName ? ` · ${pondName}` : ''}`}</span></div>
                    <div>{formatWeight(e.weight, decimalPlaces)}kg</div>
                    <div>{prize || '—'}</div>
                  </div>
                );
              }) : (
                <div className="kl-no-data">Tiada rekod berat untuk event ini.</div>
              )}
            </section>
          </div>
      </section>}
    </div>
  );
};

export default LiveResults;
