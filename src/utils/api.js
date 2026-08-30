const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Get auth token from localStorage
const getToken = () => localStorage.getItem('token');

// API request helper
const apiRequest = async (endpoint, options = {}) => {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
};

// Auth API
export const authAPI = {
  register: async (name, email, password) => {
    return apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    });
  },

  login: async (email, password) => {
    return apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
};

// Expenses API
export const expensesAPI = {
  getAll: async () => {
    return apiRequest('/expenses');
  },

  add: async (amount, description, category) => {
    return apiRequest('/expenses', {
      method: 'POST',
      body: JSON.stringify({ amount: Number(amount), description, category }),
    });
  },

  delete: async (id) => {
    return apiRequest(`/expenses/${id}`, {
      method: 'DELETE',
    });
  },

  getTotals: async () => {
    return apiRequest('/expenses/totals');
  },
};

// Goals API
export const goalsAPI = {
  getAll: async () => {
    return apiRequest('/goals');
  },

  create: async (name, target) => {
    return apiRequest('/goals', {
      method: 'POST',
      body: JSON.stringify({ name, target: Number(target) }),
    });
  },

  deposit: async (id, amount) => {
    return apiRequest(`/goals/${id}/deposit`, {
      method: 'PATCH',
      body: JSON.stringify({ amount: Number(amount) }),
    });
  },

  delete: async (id) => {
    return apiRequest(`/goals/${id}`, {
      method: 'DELETE',
    });
  },
};

// Budget API
export const budgetAPI = {
  get: async () => {
    return apiRequest('/budget');
  },

  update: async (income, fixed, savings) => {
    return apiRequest('/budget', {
      method: 'PUT',
      body: JSON.stringify({
        income: Number(income) || 0,
        fixed: Number(fixed) || 0,
        savings: Number(savings) || 0,
      }),
    });
  },
};

// User API
export const userAPI = {
  getProfile: async () => {
    return apiRequest('/user/profile');
  },
};
