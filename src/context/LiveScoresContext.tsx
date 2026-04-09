import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import { Score, Competition } from '../types';
import { getLB } from '../utils';
import { useBooking } from './BookingContext';

interface LiveScoresContextType {
  scores: Record<number, Score>;
  comp: Competition;
  topN: number;
  pondFilter: string;
  
  setScores: (scores: Record<number, Score>) => void;
  setComp: (comp: Competition) => void;
  setTopN: (n: number) => void;
  setPondFilter: (filter: string) => void;
  addScore: (peg: number, weight: number, anglerName: string, pondId: number, pondName: string) => void;
  getLeaderboard: (filter?: string | null) => ReturnType<typeof getLB>;
}

const LiveScoresContext = createContext<LiveScoresContextType | undefined>(undefined);

export const LiveScoresProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { db } = useBooking();
  const [scores, setScores] = useState<Record<number, Score>>(db.scores || {});
  const [comp, setComp] = useState<Competition>(db.comp);
  const [topN, setTopN] = useState(db.comp?.topN || 20);
  const [pondFilter, setPondFilter] = useState('all');

  useEffect(() => {
    setScores(db.scores || {});
    setComp(db.comp);
    setTopN(db.comp?.topN || 20);
  }, [db.scores, db.comp]);

  const addScore = useCallback((peg: number, weight: number, anglerName: string, pondId: number, pondName: string) => {
    setScores(prev => ({
      ...prev,
      [peg]: { weight, anglerName, pondId, pondName }
    }));
  }, []);

  const getLeaderboard = useCallback((filter?: string | null) => {
    const filterPond = filter && filter !== 'all' ? parseInt(filter) : null;
    return getLB(scores, filterPond);
  }, [scores]);

  return (
    <LiveScoresContext.Provider
      value={{
        scores,
        comp,
        topN,
        pondFilter,
        setScores,
        setComp,
        setTopN,
        setPondFilter,
        addScore,
        getLeaderboard
      }}
    >
      {children}
    </LiveScoresContext.Provider>
  );
};

export const useLiveScores = () => {
  const context = useContext(LiveScoresContext);
  if (!context) {
    throw new Error('useLiveScores must be used within LiveScoresProvider');
  }
  return context;
};