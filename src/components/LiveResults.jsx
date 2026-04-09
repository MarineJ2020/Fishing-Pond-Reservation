import React, { useState, useEffect } from 'react';
import { getLB, p2, getPrize, rbc, rbc2 } from '../utils';
const LiveResults = ({ comp, scores, ponds, bookings, user }) => {
    const [cdBlocks, setCdBlocks] = useState({ d: '--', h: '--', m: '--', s: '--' });
    const [cdStatus, setCdStatus] = useState('upcoming');
    const [topN, setTopN] = useState(comp.topN);
    const [lpf, setLpf] = useState('all');
    useEffect(() => {
        const tick = () => {
            const now = Date.now();
            const start = new Date(comp.startDate).getTime();
            const end = new Date(comp.endDate).getTime();
            let target, status;
            if (now < start) {
                target = start;
                status = 'upcoming';
            }
            else if (now < end) {
                target = end;
                status = 'live';
            }
            else {
                status = 'ended';
            }
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
    }, [comp]);
    const filter = lpf === 'all' ? null : parseInt(lpf);
    const lb = getLB(scores, filter).slice(0, topN);
    const userPegs = user ? bookings.filter(b => b.userId === user.email && b.status === 'confirmed').flatMap(b => b.seats) : [];
    let myEntry = null;
    let myRank = -1;
    userPegs.forEach(peg => {
        const idx = lb.findIndex(e => e.peg === peg);
        if (idx !== -1 && (myRank === -1 || idx < myRank)) {
            myRank = idx;
            myEntry = lb[idx];
        }
    });
    const pondFilterBtns = [
        { key: 'all', label: 'All Ponds' },
        ...ponds.map(p => ({ key: p.id.toString(), label: p.name.split('—')[0].trim() }))
    ];
    return (<div className="live-page">
      {/* Countdown */}
      <div className="countdown-wrap">
        <div>
          <div className="countdown-label">Competition Status</div>
          <div className="countdown-title">{comp.name}</div>
          <div className="countdown-sub">
            {new Date(comp.startDate).toLocaleDateString('en-MY', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        })}
          </div>
        </div>
        <div className="countdown-blocks">
          <div className="cd-block">
            <div className="cd-num">{cdBlocks.d}</div>
            <div className="cd-unit">Days</div>
          </div>
          <div className="cd-sep">:</div>
          <div className="cd-block">
            <div className="cd-num">{cdBlocks.h}</div>
            <div className="cd-unit">Hours</div>
          </div>
          <div className="cd-sep">:</div>
          <div className="cd-block">
            <div className="cd-num">{cdBlocks.m}</div>
            <div className="cd-unit">Min</div>
          </div>
          <div className="cd-sep">:</div>
          <div className="cd-block">
            <div className="cd-num">{cdBlocks.s}</div>
            <div className="cd-unit">Sec</div>
          </div>
        </div>
        <div className={`cd-status cd-${cdStatus}`}>
          <i className={`fa-regular fa-${cdStatus === 'upcoming' ? 'clock' : cdStatus === 'live' ? 'circle-play' : 'flag-checkered'}`}></i>{' '}
          {cdStatus === 'upcoming' ? 'Upcoming' : cdStatus === 'live' ? 'LIVE NOW' : 'Competition Ended'}
        </div>
      </div>

      {/* My score card */}
      {user && myEntry && (<div className="my-score-card">
          <div className="my-score-inner">
            <div className="my-rank-badge" style={{ background: rbg(myRank + 1), color: rbc2(myRank + 1) }}>
              {myRank + 1 <= 3 ? ['🥇', '🥈', '🥉'][myRank] : myRank + 1}
            </div>
            <div>
              <div className="my-score-name">{user.name}</div>
              <div className="my-score-peg">Peg #{myEntry.peg} · {myEntry.pondName}</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="my-score-weight">{myEntry.weight.toFixed(2)}</div>
            <div className="my-score-unit">kg total</div>
            <div className="my-score-prize">{getPrize(myRank + 1, comp.prizes) ? `🏆 ${getPrize(myRank + 1, comp.prizes)}` : ''}</div>
          </div>
        </div>)}

      {/* Ranking */}
      <div className="live-header">
        <div className="live-title">🏆 LIVE RANKING</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <span className="last-upd">Updated {new Date().toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          <div className="top-n-ctl">
            Show Top <input type="number" value={topN} min={1} max={500} onChange={(e) => setTopN(parseInt(e.target.value) || 20)}/>
            Anglers
          </div>
        </div>
      </div>

      <div className="pond-filter">
        {pondFilterBtns.map(btn => (<div key={btn.key} className={`pf-btn ${lpf === btn.key ? 'active' : ''}`} onClick={() => setLpf(btn.key)}>
            {btn.label}
          </div>))}
      </div>

      <div className="rank-wrap">
        <table className="rank-table">
          <thead>
            <tr>
              <th style={{ width: '50px' }}>Rank</th>
              <th>Angler</th>
              <th>Peg</th>
              <th>Pond</th>
              <th style={{ textAlign: 'right' }}>Score (kg)</th>
              <th>Prize</th>
            </tr>
          </thead>
          <tbody>
            {lb.length ? lb.map((e, i) => {
            const rank = i + 1;
            const prize = getPrize(rank, comp.prizes);
            const isMe = userPegs.includes(e.peg);
            const pond = ponds.find(p => p.id === e.pondId);
            return (<tr key={e.peg} className={isMe ? 'my-row' : ''}>
                  <td>
                    <span className={`rbadge ${rbc(rank)}`}>
                      {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontWeight: 600 }}>{e.name}</span>
                    {isMe && <span style={{ fontSize: '10px', color: 'var(--accent)', marginLeft: '6px', fontFamily: 'var(--fm)' }}>← YOU</span>}
                  </td>
                  <td>
                    <span style={{ fontFamily: 'var(--fm)', color: 'var(--muted)' }}>#{e.peg}</span>
                  </td>
                  <td>
                    <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{pond ? pond.name.split('—')[0].trim() : ''}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="w-cell">{e.weight.toFixed(2)}</span>{' '}
                    <span style={{ fontSize: '10px', color: 'var(--muted)' }}>kg</span>
                  </td>
                  <td>
                    {prize ? <span className="prize-badge">{prize}</span> : <span style={{ color: 'var(--muted)', fontSize: '11px' }}>—</span>}
                  </td>
                </tr>);
        }) : (<tr>
                <td colSpan={6} className="no-data">
                  <i className="fa-solid fa-fish-fins"></i>No scores recorded yet — check back during the competition!
                </td>
              </tr>)}
          </tbody>
        </table>
      </div>
    </div>);
};
export default LiveResults;
