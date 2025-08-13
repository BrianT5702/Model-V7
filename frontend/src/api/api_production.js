import axios from 'axios';

// Automatically detect environment and set appropriate base URL
const getBaseURL = () => {
    if (process.env.NODE_ENV === 'production') {
        // In production, use the same domain (relative URL)
        return '/api/';
    } else {
        // In development, use localhost
        return 'http://127.0.0.1:8000/api/';
    }
};

const api = axios.create({
    baseURL: getBaseURL(),
    timeout: 30000, // 30 second timeout
});

// Add request interceptor for logging
api.interceptors.request.use(
    (config) => {
        console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
    },
    (error) => {
        console.error('API Request Error:', error);
        return Promise.reject(error);
    }
);

// Add response interceptor for error handling
api.interceptors.response.use(
    (response) => {
        return response;
    },
    (error) => {
        console.error('API Response Error:', error);
        if (error.response?.status === 401) {
            // Handle unauthorized access
            console.log('Unauthorized access detected');
        }
        return Promise.reject(error);
    }
);

// Room height calculation
export const calculateMinWallHeight = (wallIds) => api.post('/rooms/calculate_min_height/', { wall_ids: wallIds });

export default api;
