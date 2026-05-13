import React, { useState, useEffect, useRef } from 'react';
import { Competition, Score, ScoreEntry, Pond, Booking, User } from '../types';
import { getLB, p2, getPrize, rbc, rbc2, rbg } from '../utils';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { db as firestoreDb } from '../../lib/firebase';

interface LiveResultsProps {
  comp: Competition;
  competitions: Competition[];
  scores: Record<number, Score>;
  ponds: Pond[];
  bookings: Booking[];
  user: User | null;
}

const LiveResults: React.FC<LiveResultsProps> = ({ comp, competitions, ponds, bookings, user }) => {
  const [selectedCompId, setSelectedCompId] = useState(comp.id || '');
  const [liveScores, setLiveScores] = useState<ScoreEntry[]>([]);
  const [loadingScores, setLoadingScores] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [cdBlocks, setCdBlocks] = useState({ d: '--', h: '--', m: '--', s: '--' });
  const [cdStatus, setCdStatus] = useState<'upcoming' | 'live' | 'ended'>('upcoming');
  const [topN, setTopN] = useState(comp.topN || 20);
  const [lpf, setLpf] = useState('all');
  const [slideDir, setSlideDir] = useState<'left' | 'right'>('right');
  const [compAnimKey, setCompAnimKey] = useState(0);

  // Sync selected ID when the default comp changes
  useEffect(() => {
    if (comp.id && !selectedCompId) setSelectedCompId(comp.id);
  }, [comp.id]);

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

  const displayComp = competitions.find(c => c.id === selectedCompId) || comp;

  const switchComp = (dir: 'prev' | 'next') => {
    const idx = competitions.findIndex(c => c.id === selectedCompId);
    const nextIdx = dir === 'prev' ? idx - 1 : idx + 1;
    if (nextIdx < 0 || nextIdx >= competitions.length) return;
    const nextComp = competitions[nextIdx];
    setSlideDir(dir === 'next' ? 'left' : 'right');
    setCompAnimKey(k => k + 1);
    setSelectedCompId(nextComp.id || '');
    setLpf('all');
    setTopN(nextComp.topN || 20);
  };

  const currentIdx = competitions.findIndex(c => c.id === selectedCompId);

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
  liveScores.forEach(e => {
    scoresRecord[e.seatNum] = { weight: e.weight, anglerName: e.anglerName, pondId: e.pondId, pondName: e.pondName };
  });

  // Active ponds for this competition
  const displayPonds = displayComp.activePondIds?.length
    ? ponds.filter(p => displayComp.activePondIds!.includes(p._docId || p.id.toString()))
    : ponds;

  const filter = lpf === 'all' ? null : parseInt(lpf);
  const lb = getLB(scoresRecord, filter).slice(0, topN);

  const displayBookings = bookings.filter(b => (b.competitionId || comp.id) === selectedCompId);
  const userPegs = user ? displayBookings.filter(b => b.userId === user.email && b.status === 'confirmed').flatMap(b => b.seats) : [];
  let myEntry: { peg: number; name: string; weight: number; pondId: number } | null = null;
  let myRank = -1;
  userPegs.forEach(peg => {
    const idx = lb.findIndex(e => e.peg === peg);
    if (idx !== -1 && (myRank === -1 || idx < myRank)) { myRank = idx; myEntry = lb[idx]; }
  });

  const pondFilterBtns = [
    { key: 'all', label: 'Semua Kolam' },
    ...displayPonds.map(p => ({ key: p.id.toString(), label: p.name.split('—')[0].trim() }))
  ];

  return (
    <div className="live-page">
      {/* Competition Selector tabs */}
      {competitions.length > 1 && (
        <div className="pond-filter" style={{ marginBottom: '20px' }}>
          {competitions.map(c => (
            <div
              key={c.id}
              className={`pf-btn ${selectedCompId === c.id ? 'active' : ''}`}
              onClick={() => {
                const dir = (competitions.findIndex(x => x.id === c.id) > currentIdx) ? 'left' : 'right';
                setSlideDir(dir);
                setCompAnimKey(k => k + 1);
                setSelectedCompId(c.id || '');
                setLpf('all');
                setTopN(c.topN || 20);
              }}
            >
              {c.name}
            </div>
          ))}
        </div>
      )}

      {/* Countdown with prev/next arrows */}
      <div className="comp-nav-wrap">
        {competitions.length > 1 && (
          <button
            className="comp-nav-btn"
            onClick={() => switchComp('prev')}
            disabled={currentIdx <= 0}
            aria-label="Pertandingan sebelum"
          >‹</button>
        )}
        <div key={compAnimKey} className={`countdown-wrap comp-slide-${slideDir}`} style={{ flex: 1 }}>
        <div>
          <div className="countdown-label">Competition Status</div>
          <div className="countdown-title">{displayComp.name}</div>
          <div className="countdown-sub">
            {new Date(displayComp.startDate).toLocaleDateString('en-MY', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
            })}
          </div>
        </div>
        <div className="countdown-blocks">
          <div className="cd-block"><div className="cd-num">{cdBlocks.d}</div><div className="cd-unit">Days</div></div>
          <div className="cd-sep">:</div>
          <div className="cd-block"><div className="cd-num">{cdBlocks.h}</div><div className="cd-unit">Hours</div></div>
          <div className="cd-sep">:</div>
          <div className="cd-block"><div className="cd-num">{cdBlocks.m}</div><div className="cd-unit">Min</div></div>
          <div className="cd-sep">:</div>
          <div className="cd-block"><div className="cd-num">{cdBlocks.s}</div><div className="cd-unit">Sec</div></div>
        </div>
        <div className={`cd-status cd-${cdStatus}`}>
          <i className={`fa-regular fa-${cdStatus === 'upcoming' ? 'clock' : cdStatus === 'live' ? 'circle-play' : 'flag-checkered'}`}></i>{' '}
          {cdStatus === 'upcoming' ? 'Upcoming' : cdStatus === 'live' ? 'LIVE NOW' : 'Competition Ended'}
        </div>
        </div>
        {competitions.length > 1 && (
          <button
            className="comp-nav-btn"
            onClick={() => switchComp('next')}
            disabled={currentIdx >= competitions.length - 1}
            aria-label="Pertandingan seterusnya"
          >›</button>
        )}
      </div>

      {/* My score card */}
      {user && myEntry && (
        <div className="my-score-card">
          <div className="my-score-inner">
            <div className="my-rank-badge" style={{ background: rbg(myRank + 1), color: rbc2(myRank + 1) }}>
              {myRank + 1 <= 3 ? ['🥇', '🥈', '🥉'][myRank] : myRank + 1}
            </div>
            <div>
              <div className="my-score-name">{user.name}</div>
              <div className="my-score-peg">Peg #{(myEntry as any).peg} · {(myEntry as any).pondName}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="my-score-weight">{(myEntry as any).weight.toFixed(2)}</div>
            <div className="my-score-unit">kg total</div>
            <div className="my-score-prize">{getPrize(myRank + 1, displayComp.prizes) ? `🏆 ${getPrize(myRank + 1, displayComp.prizes)}` : ''}</div>
          </div>
        </div>
      )}

      {/* Ranking Header */}
      <div className="live-header">
        <div className="live-title">🏆 LIVE RANKING</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          {loadingScores
            ? <span className="last-upd">Memuatkan...</span>
            : <span className="last-upd">Dikemaskini {lastUpdated}</span>
          }
          <div className="top-n-ctl">
            Tunjuk Top <input type="number" value={topN} min={1} max={500} onChange={(e) => setTopN(parseInt(e.target.value) || 20)} />
            Pemancingan
          </div>
        </div>
      </div>

      <div className="pond-filter">
        {pondFilterBtns.map(btn => (
          <div key={btn.key} className={`pf-btn ${lpf === btn.key ? 'active' : ''}`} onClick={() => setLpf(btn.key)}>
            {btn.label}
          </div>
        ))}
      </div>

      <div className="rank-wrap">
        <table className="rank-table">
          <thead>
            <tr>
              <th style={{ width: '50px' }}>Rank</th>
              <th>Pemancing</th>
              <th>Peg</th>
              <th>Kolam</th>
              <th style={{ textAlign: 'right' }}>Berat (kg)</th>
              <th>Hadiah</th>
            </tr>
          </thead>
          <tbody>
            {lb.length ? lb.map((e, i) => {
              const rank = i + 1;
              const prize = getPrize(rank, displayComp.prizes);
              const isMe = userPegs.includes(e.peg);
              const pond = ponds.find(p => p.id === e.pondId);
              return (
                <tr key={e.peg} className={isMe ? 'my-row' : ''}>
                  <td>
                    <span className={`rbadge ${rbc(rank)}`}>
                      {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontWeight: 600 }}>{e.name}</span>
                    {isMe && <span style={{ fontSize: '10px', color: 'var(--accent)', marginLeft: '6px', fontFamily: 'var(--fm)' }}>← ANDA</span>}
                  </td>
                  <td><span style={{ fontFamily: 'var(--fm)', color: 'var(--muted)' }}>#{e.peg}</span></td>
                  <td><span style={{ fontSize: '11px', color: 'var(--muted)' }}>{pond ? pond.name.split('—')[0].trim() : ''}</span></td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="w-cell">{e.weight.toFixed(2)}</span>{' '}
                    <span style={{ fontSize: '10px', color: 'var(--muted)' }}>kg</span>
                  </td>
                  <td>
                    {prize ? <span className="prize-badge">{prize}</span> : <span style={{ color: 'var(--muted)', fontSize: '11px' }}>—</span>}
                  </td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={6} className="no-data">
                  <i className="fa-solid fa-fish-fins"></i>{loadingScores ? 'Memuatkan data...' : 'Tiada rekod berat lagi — sila semak semula semasa pertandingan!'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default LiveResults;