// Swiss Public Holidays Helper
// Calculates Swiss public holidays for Zurich canton

/**
 * Calculate Easter Sunday for a given year
 * Uses the Anonymous Gregorian algorithm
 */
function calculateEaster(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
}

/**
 * Get all Swiss public holidays for a given year (Zurich canton)
 * Returns an array of Date objects
 */
export function getSwissHolidays(year) {
    const holidays = [];
    
    // Fixed holidays
    holidays.push(new Date(year, 0, 1));   // New Year's Day
    holidays.push(new Date(year, 0, 2));    // Berchtold's Day (Zurich)
    holidays.push(new Date(year, 4, 1));     // Labor Day
    holidays.push(new Date(year, 7, 1));   // Swiss National Day
    holidays.push(new Date(year, 11, 25)); // Christmas
    holidays.push(new Date(year, 11, 26)); // Boxing Day (St. Stephen's Day)
    
    // Calculate Easter-based holidays
    const easter = calculateEaster(year);
    
    // Good Friday (2 days before Easter)
    const goodFriday = new Date(easter);
    goodFriday.setDate(easter.getDate() - 2);
    holidays.push(goodFriday);
    
    // Easter Monday (1 day after Easter)
    const easterMonday = new Date(easter);
    easterMonday.setDate(easter.getDate() + 1);
    holidays.push(easterMonday);
    
    // Ascension Day (39 days after Easter)
    const ascension = new Date(easter);
    ascension.setDate(easter.getDate() + 39);
    holidays.push(ascension);
    
    // Whit Monday (50 days after Easter)
    const whitMonday = new Date(easter);
    whitMonday.setDate(easter.getDate() + 50);
    holidays.push(whitMonday);
    
    // Corpus Christi (60 days after Easter, Zurich observes it)
    const corpusChristi = new Date(easter);
    corpusChristi.setDate(easter.getDate() + 60);
    holidays.push(corpusChristi);
    
    return holidays;
}

/**
 * Check if a date is a Swiss public holiday
 */
export function isSwissHoliday(date) {
    const year = date.getFullYear();
    const holidays = getSwissHolidays(year);
    return holidays.some(holiday => 
        holiday.getDate() === date.getDate() &&
        holiday.getMonth() === date.getMonth() &&
        holiday.getFullYear() === date.getFullYear()
    );
}

/**
 * Get holiday name for a date (if it's a holiday)
 */
export function getHolidayName(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    
    // Fixed holidays
    if (month === 0 && day === 1) return "New Year's Day";
    if (month === 0 && day === 2) return "Berchtold's Day";
    if (month === 4 && day === 1) return "Labor Day";
    if (month === 7 && day === 1) return "Swiss National Day";
    if (month === 11 && day === 25) return "Christmas";
    if (month === 11 && day === 26) return "Boxing Day";
    
    // Calculate Easter-based holidays
    const easter = calculateEaster(year);
    
    // Good Friday
    const goodFriday = new Date(easter);
    goodFriday.setDate(easter.getDate() - 2);
    if (goodFriday.getDate() === day && goodFriday.getMonth() === month) {
        return "Good Friday";
    }
    
    // Easter Monday
    const easterMonday = new Date(easter);
    easterMonday.setDate(easter.getDate() + 1);
    if (easterMonday.getDate() === day && easterMonday.getMonth() === month) {
        return "Easter Monday";
    }
    
    // Ascension Day
    const ascension = new Date(easter);
    ascension.setDate(easter.getDate() + 39);
    if (ascension.getDate() === day && ascension.getMonth() === month) {
        return "Ascension Day";
    }
    
    // Whit Monday
    const whitMonday = new Date(easter);
    whitMonday.setDate(easter.getDate() + 50);
    if (whitMonday.getDate() === day && whitMonday.getMonth() === month) {
        return "Whit Monday";
    }
    
    // Corpus Christi
    const corpusChristi = new Date(easter);
    corpusChristi.setDate(easter.getDate() + 60);
    if (corpusChristi.getDate() === day && corpusChristi.getMonth() === month) {
        return "Corpus Christi";
    }
    
    return null;
}

