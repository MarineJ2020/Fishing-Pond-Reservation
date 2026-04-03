import React, { createContext, useContext, useState, ReactNode, useCallback, useEffect } from 'react';
import { Score, Competition } from '../types';
import { getDB } from '../data';
import { getLB } from '../utils';

interface LiveScoresContextType {
  scores: Record<number, Score>;
  comp: Competition;
  topN: number;
  pondFilter: string;
  
  // Actions
  setScores: (scores: Record<number, Score>) => void;
  setComp: (comp: Competition) => void;
  setTopN: (n: number) => void;
  setPondFilter: (filter: string) => void;
  addScore: (peg: number, weight: number, anglerName: string, pondId: number, pondName: string) => void;
  getLeaderboard: (filter?: string | null) => ReturnType<typeof getLB>;
}

const LiveScoresContext = createContext<LiveScoresContextType | undefined>(undefined);

export const LiveScoresProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [scores, setScores] = useState<Record<number, Score>>({});
  const [comp, setComp] = useState<Competition | null>(null);
  const [topN, setTopN] = useState(20);
  const [pondFilter, setPondFilter] = useState('all');

  // Initialize from database
  useEffect(() => {
    const db = getDB();
    setScores(db.scores);
    setComp(db.comp);
    setTopN(db.comp?.topN || 20);
  }, []);

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

  if (!comp) {
    return <>{children}</>;
  }

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