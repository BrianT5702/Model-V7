import axios from 'axios';

// Use same-origin /api/ in dev (CRA proxy) and production so session cookies are sent reliably.
const getBaseURL = () => {
    const explicit = process.env.REACT_APP_API_BASE_URL;
    if (explicit && explicit.trim()) {
        return explicit.trim();
    }
    return '/api/';
};

const isDevelopment = process.env.NODE_ENV !== 'production';
const UNSAFE_METHODS = new Set(['post', 'put', 'patch', 'delete']);

const readCsrfFromCookie = () => {
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
};

let cachedCsrfToken = null;
let activeShareToken = null;

export const setActiveShareToken = (token) => {
    activeShareToken = token ? String(token) : null;
};

export const clearActiveShareToken = () => {
    activeShareToken = null;
};

export const getActiveShareToken = () => activeShareToken;

const api = axios.create({
    baseURL: getBaseURL(),
    timeout: 30000,
    withCredentials: true,
    xsrfCookieName: 'csrftoken',
    xsrfHeaderName: 'X-CSRFToken',
});

const fetchCsrfToken = async () => {
    const response = await axios.get(`${getBaseURL()}csrf-token/`, {
        withCredentials: true,
    });
    const token = response.data?.csrfToken;
    if (token) {
        cachedCsrfToken = token;
    }
    return token;
};

api.interceptors.request.use(
    async (config) => {
        const method = config.method?.toLowerCase();
        const url = config.url || '';

        if (UNSAFE_METHODS.has(method) && !url.includes('csrf-token')) {
            const token = readCsrfFromCookie() || cachedCsrfToken || await fetchCsrfToken();
            if (token) {
                config.headers['X-CSRFToken'] = token;
            }
        }

        if (activeShareToken) {
            config.headers['X-Share-Token'] = activeShareToken;
        }

        if (isDevelopment) {
            console.log(`API Request: ${method?.toUpperCase()} ${url}`);
        }
        return config;
    },
    (error) => {
        if (isDevelopment) {
            console.error('API Request Error:', error);
        }
        return Promise.reject(error);
    }
);

api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (isDevelopment) {
            console.error('API Response Error:', error);
            if (error.response?.status === 401) {
                console.log('Unauthorized access detected');
            }
        }
        return Promise.reject(error);
    }
);

export const calculateMinWallHeight = (wallIds) => api.post('/rooms/calculate_min_height/', { wall_ids: wallIds });

export default api;
