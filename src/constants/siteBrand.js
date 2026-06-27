/** Public web identity — Vehicle Sentinel */
export const SITE_NAME = 'Vehicle Sentinel';
export const SITE_TAGLINE = 'Fleet Management Systems';
export const SITE_URL =
    (typeof process !== 'undefined' && process.env?.REACT_APP_SITE_URL) ||
    'https://vehiclesentinel.com';
export const SITE_LOGO_PATH = '/logowebsite.jpg';
