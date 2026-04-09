import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { getLB } from '../utils';
import { useBooking } from './BookingContext';
const LiveScoresContext = createContext(undefined);
export const LiveScoresProvider = ({ children }) => {
    const { db } = useBooking();
    const [scores, setScores] = useState(db.scores || {});
    const [comp, setComp] = useState(db.comp);
    const [topN, setTopN] = useState(db.comp?.topN || 20);
    const [pondFilter, setPondFilter] = useState('all');
    useEffect(() => {
        setScores(db.scores || {});
        setComp(db.comp);
        setTopN(db.comp?.topN || 20);
    }, [db.scores, db.comp]);
    const addScore = useCallback((peg, weight, anglerName, pondId, pondName) => {
        setScores(prev => ({
            ...prev,
            [peg]: { weight, anglerName, pondId, pondName }
        }));
    }, []);
    const getLeaderboard = useCallback((filter) => {
        const filterPond = filter && filter !== 'all' ? parseInt(filter) : null;
        return getLB(scores, filterPond);
    }, [scores]);
    return (<LiveScoresContext.Provider value={{
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
        }}>
      {children}
    </LiveScoresContext.Provider>);
};
export const useLiveScores = () => {
    const context = useContext(LiveScoresContext);
    if (!context) {
        throw new Error('useLiveScores must be used within LiveScoresProvider');
    }
    return context;
};
