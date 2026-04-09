import { useCallback, useState } from 'react';
export const useNavigation = () => {
    const [currentSection, setCurrentSection] = useState(() => {
        return sessionStorage.getItem('cb_sec') || 'home';
    });
    const goToSection = useCallback((section) => {
        setCurrentSection(section);
        sessionStorage.setItem('cb_sec', section);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);
    const goHome = useCallback(() => goToSection('home'), [goToSection]);
    const goToBook = useCallback(() => goToSection('book'), [goToSection]);
    const goToLive = useCallback(() => goToSection('live'), [goToSection]);
    const goToMyBookings = useCallback(() => goToSection('mybookings'), [goToSection]);
    const goToConfirmed = useCallback(() => goToSection('confirmed'), [goToSection]);
    return {
        currentSection,
        goToSection,
        goHome,
        goToBook,
        goToLive,
        goToMyBookings,
        goToConfirmed
    };
};
