// Admin API utility functions
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

// Helper function to get auth token from localStorage
const getAuthToken = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('adminToken');
  }
  return null;
};

// Helper function to set auth token in localStorage
export const setAuthToken = (token: string) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('adminToken', token);
  }
};

// Helper function to remove auth token from localStorage
export const removeAuthToken = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('adminToken');
  }
};

// Helper function to make authenticated requests
const makeRequest = async (endpoint: string, options: RequestInit = {}) => {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP error! status: ${response.status}`);
  }

  return response.json();
};

// Authentication APIs
export const adminAPI = {
  // Login
  login: async (email: string, password: string) => {
    const response = await fetch(`${API_BASE_URL}/superadmin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Login failed' }));
      throw new Error(error.message || 'Login failed');
    }

    return response.json();
  },

  // Dashboard Stats
  getSuperStats: () => makeRequest('/superadmin/superStats'),

  getMerchantStats: (duration: string) => 
    makeRequest(`/superadmin/merchantStats?duration=${encodeURIComponent(duration)}`),

  // Activities
  getAllActivities: () => makeRequest('/superadmin/allActivities'),

  // Merchants
  getAllMerchants: () => makeRequest('/superadmin/allMerchants'),

  // Transactions
  getAllTransactions: () => makeRequest('/superadmin/allTransactions'),

  // Plans
  createPlan: (planData: any) => 
    makeRequest('/superadmin/createPlan', {
      method: 'POST',
      body: JSON.stringify(planData),
    }),

  getAllPlans: (type?: string) => {
    const query = type ? `?type=${encodeURIComponent(type)}` : '';
    return makeRequest(`/superadmin/getAllPlans${query}`);
  },

  updatePlan: (id: number, planData: any) => 
    makeRequest(`/superadmin/plans/${id}`, {
      method: 'PUT',
      body: JSON.stringify(planData),
    }),

  deletePlan: (id: number) => 
    makeRequest(`/superadmin/plans/${id}`, {
      method: 'DELETE',
    }),

  // Roles
  createRole: (roleData: any) => 
    makeRequest('/superadmin/createRole', {
      method: 'POST',
      body: JSON.stringify(roleData),
    }),

  getAllPermissions: () => makeRequest('/superadmin/getAllPermissions'),

  getAllRoles: () => makeRequest('/superadmin/getAllRoles'),

  updateRole: (id: string | number, roleData: any) => 
    makeRequest(`/superadmin/updateRole/${id}`, {
      method: 'PUT',
      body: JSON.stringify(roleData),
    }),

  deleteRole: (id: string | number) => 
    makeRequest(`/superadmin/deleteRole/${id}`, {
      method: 'DELETE',
    }),

  // Admin Staff
  createAdminStaff: (staffData: any) => 
    makeRequest('/superadmin/createAdminStaff', {
      method: 'POST',
      body: JSON.stringify(staffData),
    }),

  updateAdminStaff: (id: string | number, staffData: any) => 
    makeRequest(`/superadmin/updateAdminStaff/${id}`, {
      method: 'PUT',
      body: JSON.stringify(staffData),
    }),

  getAllAdminStaff: () => makeRequest('/superadmin/getAllAdminStaff'),

  // Logs
  getAllAdminLogs: () => makeRequest('/superadmin/logs'),

  getAdminLogsByStaff: (staffId: number) => 
    makeRequest(`/superadmin/logs/${staffId}`),

  // Merchant Management
  updateMerchant: (id: number, merchantData: any) =>
    makeRequest(`/superadmin/merchants/${id}`, {
      method: 'PUT',
      body: JSON.stringify(merchantData),
    }),

  updateMerchantStatus: (id: number, status: string) =>
    makeRequest(`/superadmin/merchants/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  resetMerchantPassword: (id: number, newPassword: string) =>
    makeRequest(`/superadmin/merchants/${id}/reset-password`, {
      method: 'PUT',
      body: JSON.stringify({ newPassword }),
    }),

  deleteMerchant: (id: number) =>
    makeRequest(`/superadmin/merchants/${id}`, {
      method: 'DELETE',
    }),

  // Merchant Detail Tabs
  getMerchantTransactions: (id: number) =>
    makeRequest(`/superadmin/merchants/${id}/transactions`),

  getMerchantSubscriptions: (id: number) =>
    makeRequest(`/superadmin/merchants/${id}/subscriptions`),

  getMerchantLogs: (id: number) =>
    makeRequest(`/superadmin/merchants/${id}/logs`),

  // Support Tickets
  getAllTickets: () => makeRequest('/superadmin/tickets'),

  getTicketDetails: (id: number | string) => 
    makeRequest(`/superadmin/tickets/${id}`),

  replyToTicket: (id: number | string, message: string, senderId?: number) => 
    makeRequest(`/superadmin/tickets/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message, senderId }),
    }),

  updateTicketStatus: (id: number | string, status: string) => 
    makeRequest(`/superadmin/tickets/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    }),

  // Announcements
  getAllAnnouncements: () => makeRequest('/superadmin/announcements'),

  createAnnouncement: (data: any) => 
    makeRequest('/superadmin/announcements', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteAnnouncement: (id: number | string) => 
    makeRequest(`/superadmin/announcements/${id}`, {
      method: 'DELETE',
    }),

  // FAQs
  getAllFaqs: () => makeRequest('/superadmin/faqs'),

  createFaq: (data: any) => 
    makeRequest('/superadmin/faqs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteFaq: (id: number | string) => 
    makeRequest(`/superadmin/faqs/${id}`, {
      method: 'DELETE',
    }),

  // Wallet Tiers
  getWalletTiers: () => makeRequest('/superadmin/wallet-tiers'),

  createWalletTier: (tierData: any) => 
    makeRequest('/superadmin/wallet-tiers', {
      method: 'POST',
      body: JSON.stringify(tierData),
    }),

  updateWalletTier: (tierData: any) => 
    makeRequest('/superadmin/wallet-tiers', {
      method: 'PUT',
      body: JSON.stringify(tierData),
    }),

  deleteWalletTier: (id: number | string) => 
    makeRequest(`/superadmin/wallet-tiers/${id}`, {
      method: 'DELETE',
    }),

  // Verifications
  getVerifications: () => makeRequest('/superadmin/verifications'),

  getVerificationDetails: (id: number | string) => makeRequest(`/superadmin/verifications/${id}`),

  updateVerificationStatus: (id: number | string, status: 'approved' | 'rejected', rejectionReason?: string) => 
    makeRequest('/superadmin/verifications/status', {
      method: 'PUT',
      body: JSON.stringify({ id, status, rejectionReason }),
    }),
};

export default adminAPI;
