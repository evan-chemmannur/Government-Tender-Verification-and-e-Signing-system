import axios from 'axios';

// The proxy config in vite.config.js handles routing /api to localhost:3001 in dev
const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // Crucial for sending secure HttpOnly cookies automatically
});

export const setQueryClient = (client) => {
  api.queryClient = client;
};

// CSRF Handling
let csrfToken = null;

const fetchCsrfToken = async () => {
  if (csrfToken) return csrfToken;
  try {
    const res = await axios.get('/auth/csrf-token', { withCredentials: true });
    csrfToken = res.data.csrfToken;
    return csrfToken;
  } catch (err) {
    console.error('Failed to fetch CSRF token', err);
    return null;
  }
};

// Request Interceptor to attach CSRF token to all mutations
api.interceptors.request.use(async (config) => {
  if (['post', 'put', 'delete', 'patch'].includes(config.method?.toLowerCase())) {
    const token = await fetchCsrfToken();
    if (token) {
      config.headers['X-CSRF-Token'] = token;
    }
  }
  return config;
}, (error) => Promise.reject(error));

axios.interceptors.request.use(async (config) => {
  if (['post', 'put', 'delete', 'patch'].includes(config.method?.toLowerCase()) && !config.url.includes('/auth/logout')) {
    const token = await fetchCsrfToken();
    if (token) {
      config.headers['X-CSRF-Token'] = token;
    }
  }
  return config;
}, (error) => Promise.reject(error));

// Response Interceptor for robust error handling and strict state cleanup
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Check if error response exists
    if (error.response) {
      if (error.response.status === 401) {
        // Strict state cleanup implementation
        if (api.queryClient) {
          api.queryClient.clear();
        }
        
        // Prevent redirect loops if already on login or checking status
        const isAuthRoute = window.location.pathname === '/login';
        if (!isAuthRoute && !error.config.url.includes('/auth/status')) {
            window.location.href = '/login?error=session_expired';
        }
      } else if (error.response.status === 403) {
        // Don't redirect to unauthorized if it's just a failed step-up check, 
        // the ProtectedRoute will handle rendering the step-up UI.
        // But for hard forbidden actions across the app, redirecting to /unauthorized is standard.
        if (window.location.pathname !== '/unauthorized' && !error.config.url.includes('/auth/status')) {
           // We will handle 403 locally in mutations where possible, so redirecting completely might be too aggressive
           // for things like 'insufficient permissions to click this button'. Let's let the components handle 403s.
        }
      }
    }
    
    return Promise.reject(error);
  }
);

/**
 * Common API functions formatted with explicit JSDoc typing equivalents
 */

/**
 * @typedef {Object} TenderFilters
 * @property {string} [status]
 * @property {string} [department]
 * @property {number} [min_value]
 * @property {number} [max_value]
 * @property {number} [page]
 * @property {string} [sort]
 */

export const tenderApi = {
  /**
   * Fetch paginated tenders
   * @param {TenderFilters} filters 
   */
  getTenders: async (filters = {}) => {
    const params = new URLSearchParams(filters);
    const res = await api.get(`/tenders?${params.toString()}`);
    return res.data;
  },

  getTenderById: async (id) => {
    const res = await api.get(`/tenders/${id}`);
    return res.data;
  },

  createTender: async (data) => {
    const res = await api.post('/tenders', data);
    return res.data;
  },

  updateTender: async (id, data) => {
    const res = await api.put(`/tenders/${id}`, data);
    return res.data;
  },

  submitTender: async (id) => {
    const res = await api.post(`/tenders/${id}/submit`);
    return res.data;
  },

  startReview: async (id) => {
    const res = await api.post(`/tenders/${id}/start-review`);
    return res.data;
  },

  approveTender: async (id) => {
    const res = await api.post(`/tenders/${id}/approve`);
    return res.data;
  },

  signTender: async (id) => {
    const res = await api.post(`/tenders/${id}/sign`);
    return res.data;
  },

  revokeTender: async (id, data) => {
    const res = await api.post(`/tenders/${id}/revoke`, data);
    return res.data;
  },
  
  getStatistics: async () => {
    const res = await api.get('/tenders/statistics');
    return res.data;
  },

  uploadDocument: async (id, file, documentType) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', documentType);
    const res = await api.post(`/tenders/${id}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return res.data;
  },

  deleteTender: async (id) => {
    const res = await api.delete(`/tenders/${id}`);
    return res.data;
  }
};

export const authApi = {
 getMe: async () => {
  const res = await axios.get('/auth/me', { withCredentials: true });
  return res.data;
},
getStatus: async () => {
  const res = await axios.get('/auth/status', { withCredentials: true });
  return res.data;
},
refreshSession: async () => {
  const res = await axios.post('/auth/refresh', {}, { withCredentials: true });
  return res.data;
},
getLoginUrl: async (acr = 'otp') => {
  const res = await axios.get(`/auth/login-url?acr=${acr}`, { withCredentials: true });
  return res.data;
},
logout: async () => {
  const res = await axios.post('/auth/logout', {}, { withCredentials: true });
  return res.data;
}
};
export default api;
