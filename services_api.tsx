// Prefer environment variable; fallback to localhost in dev
export const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

function getAuthHeaders(): Record<string, string> {
  const user = typeof window !== 'undefined' ? window.localStorage.getItem('user') : null;
  
  if (user) {
    try {
      const parsedUser = JSON.parse(user);
      const token = parsedUser.token;
      if (token) {
        return {
          Authorization: `Bearer ${token}`,
        };
      }
    } catch (error) {
      console.error('Error parsing user from localStorage:', error);
    }
  }
  return {};
}

async function handleResponse(response: Response, defaultErrorMessage: string = 'Request failed') {
  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('user');
      // Use router if possible, but window.location is safer for non-component file
      window.location.href = '/login';
    }
    throw new Error('Session expired. Please login again.');
  }
  
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || defaultErrorMessage);
  }
  return data;
}

export async function registerUser(userData: any) {
  const response = await fetch(BASE_URL + '/merchant/signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      businessName: userData.businessName,
      businessAlias: userData.businessAlias,
      phone: userData.phoneNumber,
      email: userData.email,
      currency: userData.currency,
      password: userData.password,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Registration failed');
  }

  return data;
}
export async function loginUserWithEmail(userData:any) {
  const response = await fetch(BASE_URL+'/merchant/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: userData.email,
      password: userData.password,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Login failed');
  }

  return data;
}
export async function forgotPassword(email: string) {
  const response = await fetch(BASE_URL + '/merchant/forgot-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to send OTP');
  }
  return data;
}
export async function resendOtp(email: string) {
  const response = await fetch(BASE_URL + '/merchant/resend-otp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to resend OTP');
  }
  return data;
}
export async function verifyOtp(email: string, otp: string) {
  const payload = { email: String(email || '').trim(), otp: String(otp || '').trim() } as { email: string; otp: string };
  const response = await fetch(BASE_URL + '/merchant/verify-otp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'OTP verification failed');
  }
  return data;
}
export async function updatePassword(email: string, newPassword: string) {
  const response = await fetch(BASE_URL + '/merchant/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, newPassword }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Password update failed');
  }
  return data;
}


// Collaborator APIs
export async function collaboratorForgotPassword(email: string) {
  const response = await fetch(BASE_URL + '/collaborator/forgot-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to send OTP');
  }
  return data;
}

export async function fetchMerchantProfile() {
  const response = await fetch(BASE_URL + '/merchant/profile', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(response, 'Failed to fetch profile');
}

export async function getMerchantSubscription() {
  const response = await fetch(BASE_URL + '/merchant/subscription', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch subscription');
  }
  return data;
}

export async function fetchUpgradeStatus() {
  const response = await fetch(BASE_URL + '/wallet/upgrade-status', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(response, 'Failed to fetch upgrade status');
}

export async function collaboratorResendOtp(email: string) {
  const response = await fetch(BASE_URL + '/collaborator/resend-otp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to resend OTP');
  }
  return data;
}

export async function collaboratorVerifyOtp(email: string, otp: string) {
  const response = await fetch(BASE_URL + '/collaborator/verify-otp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, otp }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'OTP verification failed');
  }
  return data;
}

export async function collaboratorUpdatePassword(email: string, newPassword: string) {
  const response = await fetch(BASE_URL + '/collaborator/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, newPassword }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Password update failed');
  }
  return data;
}


export async function addAgent(agentData: { fullName: string; phoneNumber: string; email: string; password: string; branch: string; }) {
  // Get merchant ID from token
  const user = typeof window !== 'undefined' ? window.localStorage.getItem('user') : null;
  let merchantId = null;

  if (user) {
    try {
      const parsedUser = JSON.parse(user);
      merchantId = parsedUser.id;
    } catch (error) {
      console.error('Error parsing user for merchant ID:', error);
    }
  }

  const payload: any = {
    name: agentData.fullName, // Database requires 'name' field
    fullName: agentData.fullName,
    phoneNumber: agentData.phoneNumber,
    email: agentData.email,
    password: agentData.password,
    branch: agentData.branch,
  };
  if (merchantId) payload.merchantId = merchantId;

  const response = await fetch(BASE_URL + '/agents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to add agent');
  }
  return data;
}
export async function getBranches() {
  const response = await fetch(BASE_URL + '/branches', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch branches');
  }
  return data;
}

export async function updateAgent(agentData: { id: number; fullName: string; phoneNumber: string; email: string; password: string; branch: string; status?: string; }) {
  const formData = new FormData();
  formData.append('id', String(agentData.id));
  formData.append('fullName', agentData.fullName);
  formData.append('phoneNumber', agentData.phoneNumber);
  formData.append('email', agentData.email);
  formData.append('password', agentData.password);
  formData.append('branch', agentData.branch);
  if (agentData.status) {
    formData.append('status', agentData.status);
  }
  
  const response = await fetch(BASE_URL + '/agents', {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update agent');
  }
  return data;
}

export async function updateAgentStatus(agentId: number, status: string) {
  const formData = new FormData();
  formData.append('status', status);
  
  const response = await fetch(BASE_URL + `/agents/${agentId}/status`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update agent status');
  }
  return data;
}
export async function fetchAgents() {
  const response = await fetch(BASE_URL + '/agents', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(response, 'Failed to fetch agents');
}
export async function fetchAgentById(id: number) {
  const response = await fetch(BASE_URL + `/agents/${id}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch agent');
  }
  return data;
}
export async function createBranch(branchData: { name: string; state: string; location: string; }) {
  console.log('Creating branch with data:', branchData);

  // Get merchant ID from token
  const user = typeof window !== 'undefined' ? window.localStorage.getItem('user') : null;
  let merchantId = null;

  if (user) {
    try {
      const parsedUser = JSON.parse(user);
      merchantId = parsedUser.id;
      console.log('Merchant ID from token:', merchantId);
    } catch (error) {
      console.error('Error parsing user for merchant ID:', error);
    }
  }

  const formData = new FormData();
  formData.append('name', branchData.name);
  formData.append('state', branchData.state);
  formData.append('location', branchData.location);
  if (merchantId) {
    formData.append('merchantId', String(merchantId));
  }

  const headers = getAuthHeaders();
  console.log('Headers being sent:', headers);
  console.log('FormData contents:', { name: branchData.name, state: branchData.state, location: branchData.location, merchantId });

  const response = await fetch(BASE_URL + '/branches', {
    method: 'POST',
    headers: headers,
    body: formData,
  });

  console.log('Response status:', response.status);
  const data = await response.json();
  console.log('Response data:', data);

  if (!response.ok) {
    throw new Error(data.message || 'Failed to create branch');
  }
  return data;
}
export async function updateBranch(branchData: { id: number; name: string; state: string; location: string; }) {
  const formData = new FormData();
  formData.append('id', String(branchData.id));
  formData.append('name', branchData.name);
  formData.append('state', branchData.state);
  formData.append('location', branchData.location);
  const response = await fetch(BASE_URL + '/branches', {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update branch');
  }
  return data;
}
export async function fetchBranches() {
  const response = await fetch(BASE_URL + '/branches', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch branches');
  }
  return data;
}
export async function deleteBranch(branchId: number) {
  const response = await fetch(BASE_URL + `/branches/${branchId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to delete branch');
  }
  return data;
}
export async function addCustomer(customerData: { fullName: string; phoneNumber: string; email: string; agentId: string; branchId: string; packageId?: string; accountNumber?: string; alias?: string; address?: string; }) {
  // Get merchant ID from token
  const user = typeof window !== 'undefined' ? window.localStorage.getItem('user') : null;
  let merchantId: number | null = null;
  if (user) {
    try {
      const parsedUser = JSON.parse(user);
      merchantId = parsedUser.id;
    } catch (e) {
      console.error('Error parsing user for merchant ID:', e);
    }
  }

  const formData = new FormData();
  formData.append('name', customerData.fullName); // Database requires 'name' field
  formData.append('fullName', customerData.fullName);
  formData.append('phoneNumber', customerData.phoneNumber);
  formData.append('email', customerData.email);
  if (customerData.alias) {
    formData.append('alias', customerData.alias);
  }
  if (customerData.address) {
    formData.append('address', customerData.address);
  }
  formData.append('agentId', customerData.agentId);
  formData.append('branchId', customerData.branchId);
  if (customerData.accountNumber) {
    formData.append('accountNumber', customerData.accountNumber);
  }
  if (customerData.packageId) {
    formData.append('packageId', customerData.packageId);
  }
  if (merchantId) {
    formData.append('merchantId', String(merchantId));
  }
  const response = await fetch(BASE_URL + '/customers', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to add customer');
  }
  return data;
}
export async function fetchCustomers() {
  const response = await fetch(BASE_URL + '/customers', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(response, 'Failed to fetch customers');
}

export async function fetchCustomerById(customerId: string | number) {
  const response = await fetch(BASE_URL + `/customers/${customerId}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(response, 'Failed to fetch customer by ID');
}

export async function updateCustomer(id: number, customerData: { 
  fullName?: string; 
  phoneNumber?: string; 
  email?: string; 
  address?: string; 
  packageId?: string;
  agentId?: string;
  branchId?: string;
}) {
  const formData = new FormData();
  formData.append('id', String(id));
  if (customerData.fullName) {
    formData.append('name', customerData.fullName);
    formData.append('fullName', customerData.fullName);
  }
  if (customerData.phoneNumber) formData.append('phoneNumber', customerData.phoneNumber);
  if (customerData.email) formData.append('email', customerData.email);
  if (customerData.address) formData.append('address', customerData.address);
  if (customerData.packageId) formData.append('packageId', customerData.packageId);
  if (customerData.agentId) formData.append('agentId', customerData.agentId);
  if (customerData.branchId) formData.append('branchId', customerData.branchId);

  const response = await fetch(BASE_URL + `/customers`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update customer');
  }
  return data;
}
// Role APIs
export async function createRole(roleData: { roleName: string; cantView: number; canViewOnly: number; canEdit: number; permissions: Record<string, string>; }) {
  const formData = new FormData();
  formData.append('roleName', roleData.roleName);
  formData.append('cantView', String(roleData.cantView));
  formData.append('canViewOnly', String(roleData.canViewOnly));
  formData.append('canEdit', String(roleData.canEdit));
  formData.append('permissions', JSON.stringify(roleData.permissions));
  const response = await fetch(BASE_URL + '/roles', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create role');
  }
  return data;
}

export async function fetchRoles() {
  const response = await fetch(BASE_URL + '/roles', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch roles');
  }
  return data;
}

export async function updateRole(roleData: { id: number; roleName: string; cantView: number; canViewOnly: number; canEdit: number; permissions: Record<string, string>; }) {
  const formData = new FormData();
  formData.append('id', String(roleData.id));
  formData.append('roleName', roleData.roleName);
  formData.append('cantView', String(roleData.cantView));
  formData.append('canViewOnly', String(roleData.canViewOnly));
  formData.append('canEdit', String(roleData.canEdit));
  formData.append('permissions', JSON.stringify(roleData.permissions));
  const response = await fetch(BASE_URL + '/roles', {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update role');
  }
  return data;
}
// Staff APIs
export async function createStaff(staffData: { branch: string; fullName: string; email: string; phoneNumber: string; role: string; }) {
  // Attempt to include merchant identification to avoid "merchant not found"
  let merchantId: number | null = null;
  try {
    const userStr = typeof window !== 'undefined' ? window.localStorage.getItem('user') : null;
    if (userStr) {
      const parsed = JSON.parse(userStr);
      const possible = parsed?.merchantId || parsed?.id || parsed?.merchant?.id || parsed?.user?.id;
      if (possible) merchantId = Number(possible);
    }
  } catch {}

  const formData = new FormData();
  formData.append('branch', staffData.branch);
  formData.append('fullName', staffData.fullName);
  formData.append('email', staffData.email);
  formData.append('phoneNumber', staffData.phoneNumber);
  formData.append('role', staffData.role);
  // Also pass roleId explicitly to satisfy backend controller
  if (staffData.role && !Number.isNaN(Number(staffData.role))) {
    formData.append('roleId', String(staffData.role));
  }
  if (merchantId) {
    formData.append('merchantId', String(merchantId));
  }

  // Also pass merchant in header if backend supports it
  const extraHeaders: Record<string, string> = {};
  if (merchantId) extraHeaders['x-merchant-id'] = String(merchantId);

  const response = await fetch(BASE_URL + '/staff', {
    method: 'POST',
    headers: { ...getAuthHeaders(), ...extraHeaders },
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create staff');
  }
  return data;
}

export async function listStaff() {
  const response = await fetch(BASE_URL + '/staff', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch staff');
  }
  return data;
}

export async function updateStaff(staffData: { id: number; branch: string; fullName: string; email: string; phoneNumber: string; role: string; status: string; }) {
  const formData = new FormData();
  formData.append('id', String(staffData.id));
  formData.append('branch', staffData.branch);
  formData.append('fullName', staffData.fullName);
  formData.append('email', staffData.email);
  formData.append('phoneNumber', staffData.phoneNumber);
  formData.append('role', staffData.role);
  formData.append('status', staffData.status);
  const response = await fetch(BASE_URL + '/staff', {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update staff');
  }
  return data;
}

// Transaction APIs
export async function getUserTransactions() {
  const response = await fetch(BASE_URL + '/wallet/transactions', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(response, 'Failed to fetch transactions');
}

export async function getTransactionById(id: string) {
  const response = await fetch(BASE_URL + `/wallet/transactions/${id}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch transaction');
  }
  return data;
}

export async function createTransaction(transactionData: { type: string; amount: number; description: string; recipientId?: string; }) {
  const response = await fetch(BASE_URL + '/wallet/transactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(transactionData),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create transaction');
  }
  return data;
}

// Summary APIs
export async function getUserSummary() {
  const response = await fetch(BASE_URL + '/api/summary', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(response, 'Failed to fetch user summary');
}

export async function getUserStats() {
  const response = await fetch(BASE_URL + '/api/user/stats', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(response, 'Failed to fetch user stats');
}

// Charges APIs
export async function createCharge(chargeData: { chargeName: string; type: string; amount: string; }) {
  const response = await fetch(BASE_URL + '/charges', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(chargeData),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create charge');
  }
  return data;
}

export async function assignCharge(assignData: { chargeName: string; amount: string; dueDate: string; customer: string; }) {
  const response = await fetch(BASE_URL + '/charges/assign', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(assignData),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to assign charge');
  }
  return data;
}

export async function updateChargeAssignmentStatus(id: number, status: string) {
  const response = await fetch(BASE_URL + '/charges/assign/status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ id, status }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update charge status');
  }
  return data;
}

export async function fetchCharges() {
  const response = await fetch(BASE_URL + '/charges', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch charges');
  }
  return data;
}

export async function fetchChargeHistory() {
  const response = await fetch(BASE_URL + '/charges/history', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch charge history');
  }
  return data;
}

export async function updateCharge(chargeData: { id: number; chargeName?: string; type?: string; amount?: string | number; }) {
  const response = await fetch(BASE_URL + '/charges', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(chargeData),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update charge');
  }
  return data;
}

// Loan APIs (legacy - removed duplicate)

// Investment APIs
export async function createInvestment(investmentData: { customerName: string; amount: number; plan: string; duration: number; }) {
  const formData = new FormData();
  formData.append('customerName', investmentData.customerName);
  formData.append('amount', String(investmentData.amount));
  formData.append('plan', investmentData.plan);
  formData.append('duration', String(investmentData.duration));
  
  const response = await fetch(BASE_URL + '/investments', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create investment');
  }
  return data;
}

export async function fetchInvestments() {
  const response = await fetch(BASE_URL + '/investments', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch investments');
  }
  return data;
}

// Package APIs
export async function createPackage(packageData: { 
  name: string; 
  type: string; 
  amount: number; 
  seedAmount: number; 
  seedType: string; 
  period: number; 
  collectionDays: string; 
  duration: number; 
  benefits: string[]; 
  description?: string; 
  interestRate?: number;
  extraCharges?: number;
  defaultPenalty?: number;
  defaultDays?: number;
  defaultPercentageRate?: number;
  // Loan-specific fields
  loanAmount?: number;
  loanInterestRate?: number;
  interestAmount?: number;
  loanPeriod?: number;
  defaultAmount?: number;
  gracePeriod?: number;
  loanCharges?: number;
  packageCategory?: string;
}) {
  // Include merchantId
  const user = typeof window !== 'undefined' ? window.localStorage.getItem('user') : null;
  let merchantId: number | null = null;
  if (user) {
    try {
      const parsedUser = JSON.parse(user);
      const possible = parsedUser?.id || parsedUser?.merchantId || parsedUser?.user?.id || parsedUser?.merchant?.id;
      if (possible) merchantId = Number(possible);
    } catch {}
  }
  const formData = new FormData();
  formData.append('name', packageData.name);
  formData.append('type', packageData.type);
  formData.append('amount', String(packageData.amount));
  formData.append('seedAmount', String(packageData.seedAmount));
  formData.append('seedType', packageData.seedType);
  formData.append('period', String(packageData.period));
  formData.append('collectionDays', packageData.collectionDays);
  formData.append('duration', String(packageData.duration));
  formData.append('benefits', JSON.stringify(packageData.benefits));
  if (merchantId) {
    formData.append('merchantId', String(merchantId));
  }
  if (packageData.description) {
    formData.append('description', packageData.description);
  }
  if (packageData.interestRate) {
    formData.append('interestRate', String(packageData.interestRate));
  }
  if (packageData.extraCharges) {
    formData.append('extraCharges', String(packageData.extraCharges));
  }
  if (packageData.defaultPenalty) {
    formData.append('defaultPenalty', String(packageData.defaultPenalty));
  }
  if (packageData.defaultDays) {
    formData.append('defaultDays', String(packageData.defaultDays));
  }
  if (packageData.defaultPercentageRate !== undefined) {
    formData.append('defaultPercentageRate', String(packageData.defaultPercentageRate));
  }
  // Loan-specific fields
  if (packageData.loanAmount) {
    formData.append('loanAmount', String(packageData.loanAmount));
  }
  if (packageData.loanInterestRate) {
    formData.append('loanInterestRate', String(packageData.loanInterestRate));
  }
  if (packageData.interestAmount) {
    formData.append('interestAmount', String(packageData.interestAmount));
  }
  if (packageData.loanPeriod) {
    formData.append('loanPeriod', String(packageData.loanPeriod));
  }
  if (packageData.defaultAmount) {
    formData.append('defaultAmount', String(packageData.defaultAmount));
  }
  if (packageData.gracePeriod) {
    formData.append('gracePeriod', String(packageData.gracePeriod));
  }
  if (packageData.loanCharges) {
    formData.append('loanCharges', String(packageData.loanCharges));
  }
  if (packageData.packageCategory) {
    formData.append('packageCategory', packageData.packageCategory);
  }
  
  const response = await fetch(BASE_URL + '/packages', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create package');
  }
  return data;
}

export async function fetchPackages(category?: string) {
  const url = category ? `${BASE_URL}/packages?category=${category}` : `${BASE_URL}/packages`;
  const response = await fetch(url, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(response, 'Failed to fetch packages');
}

export async function updatePackage(packageData: { 
  id: number; 
  name: string; 
  type: string; 
  amount: number; 
  seedAmount: number; 
  seedType: string; 
  period: number; 
  collectionDays: string; 
  duration: number; 
  benefits: string[]; 
  description?: string; 
  status?: string; 
  interestRate?: number;
  extraCharges?: number;
  defaultPenalty?: number;
  defaultDays?: number;
  defaultPercentageRate?: number;
  // Loan-specific fields
  loanAmount?: number;
  loanInterestRate?: number;
  interestAmount?: number;
  loanPeriod?: number;
  defaultAmount?: number;
  gracePeriod?: number;
  loanCharges?: number;
  packageCategory?: string;
}) {
  const formData = new FormData();
  formData.append('id', String(packageData.id));
  formData.append('name', packageData.name);
  formData.append('type', packageData.type);
  formData.append('amount', String(packageData.amount));
  formData.append('seedAmount', String(packageData.seedAmount));
  formData.append('seedType', packageData.seedType);
  formData.append('period', String(packageData.period));
  formData.append('collectionDays', packageData.collectionDays);
  formData.append('duration', String(packageData.duration));
  formData.append('benefits', JSON.stringify(packageData.benefits));
  if (packageData.description) {
    formData.append('description', packageData.description);
  }
  if (packageData.status) {
    formData.append('status', packageData.status);
  }
  if (packageData.interestRate) {
    formData.append('interestRate', String(packageData.interestRate));
  }
  if (packageData.extraCharges) {
    formData.append('extraCharges', String(packageData.extraCharges));
  }
  if (packageData.defaultPenalty) {
    formData.append('defaultPenalty', String(packageData.defaultPenalty));
  }
  if (packageData.defaultDays) {
    formData.append('defaultDays', String(packageData.defaultDays));
  }
  if (packageData.defaultPercentageRate !== undefined) {
    formData.append('defaultPercentageRate', String(packageData.defaultPercentageRate));
  }
  // Loan-specific fields
  if (packageData.loanAmount) {
    formData.append('loanAmount', String(packageData.loanAmount));
  }
  if (packageData.loanInterestRate) {
    formData.append('loanInterestRate', String(packageData.loanInterestRate));
  }
  if (packageData.interestAmount) {
    formData.append('interestAmount', String(packageData.interestAmount));
  }
  if (packageData.loanPeriod) {
    formData.append('loanPeriod', String(packageData.loanPeriod));
  }
  if (packageData.defaultAmount) {
    formData.append('defaultAmount', String(packageData.defaultAmount));
  }
  if (packageData.gracePeriod) {
    formData.append('gracePeriod', String(packageData.gracePeriod));
  }
  if (packageData.loanCharges) {
    formData.append('loanCharges', String(packageData.loanCharges));
  }
  if (packageData.packageCategory) {
    formData.append('packageCategory', packageData.packageCategory);
  }
  
  const response = await fetch(BASE_URL + '/packages', {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update package');
  }
  return data;
}

export async function deletePackage(packageId: number) {
  const response = await fetch(BASE_URL + `/packages/${packageId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to delete package');
  }
  return data;
}

// Add a new function to fetch loan packages specifically
export async function fetchLoanPackages(params?: { 
  status?: string; 
  search?: string; 
  type?: string; 
  page?: number; 
  limit?: number; 
}) {
  const queryParams = new URLSearchParams();
  queryParams.append('category', 'Loan');
  if (params?.status) queryParams.append('status', params.status);
  if (params?.type) queryParams.append('type', params.type);
  if (params?.page) queryParams.append('page', String(params.page));
  if (params?.limit) queryParams.append('limit', String(params.limit));
  
  const response = await fetch(BASE_URL + '/packages?' + queryParams.toString(), {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(response, 'Failed to fetch loan packages');
}

// Collection APIs
export async function createCollection(collectionData: { 
  customerName: string; 
  amount: number; 
  dueDate: string; 
  type: string;
  packageName?: string;
  packageAmount?: number;
  cycle?: number;
  cycleCounter?: number;
  isFirstCollection?: boolean;
  customerId?: number | string;
}) {
  const formData = new FormData();
  formData.append('customerName', collectionData.customerName);
  if (collectionData.customerId) {
    formData.append('customerId', String(collectionData.customerId));
  }
  formData.append('amount', String(collectionData.amount));
  formData.append('dueDate', collectionData.dueDate);
  formData.append('type', collectionData.type);
  
  if (collectionData.packageName) {
    formData.append('packageName', collectionData.packageName);
  }
  if (collectionData.packageAmount) {
    formData.append('packageAmount', String(collectionData.packageAmount));
  }
  if (collectionData.cycle) {
    formData.append('cycle', String(collectionData.cycle));
  }
  if (collectionData.cycleCounter) {
    formData.append('cycleCounter', String(collectionData.cycleCounter));
  }
  if (collectionData.isFirstCollection !== undefined) {
    formData.append('isFirstCollection', String(collectionData.isFirstCollection));
  }
  
  const response = await fetch(BASE_URL + '/collections', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create collection');
  }
  return data;
}

export async function fetchCollections(params?: { customerId?: string | number; search?: string; }) {
  const queryParams = new URLSearchParams();
  if (params?.customerId) queryParams.append('customerId', String(params.customerId));
  if (params?.search) queryParams.append('search', params.search);
  
  const response = await fetch(BASE_URL + '/collections?' + queryParams.toString(), {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(response, 'Failed to fetch collections');
}

// Remittances APIs
export async function createRemittance(payload: {
  collectionId?: number;
  customerId: number;
  amount: number;
  notes?: string;
}) {
  const formData = new FormData();
  if (payload.collectionId !== undefined) formData.append('collectionId', String(payload.collectionId));
  formData.append('customerId', String(payload.customerId));
  formData.append('amount', String(payload.amount));
  if (payload.notes !== undefined) formData.append('notes', payload.notes);
  const response = await fetch(BASE_URL + '/remittances', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to create remittance');
  return data;
}

export async function fetchRemittances() {
  const response = await fetch(BASE_URL + '/remittances', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to fetch remittances');
  return data;
}

export async function updateRemittance(payload: { id: number; amount?: number; notes?: string; }) {
  const formData = new FormData();
  formData.append('id', String(payload.id));
  if (payload.amount !== undefined) formData.append('amount', String(payload.amount));
  if (payload.notes !== undefined) formData.append('notes', payload.notes);
  const response = await fetch(BASE_URL + '/remittances', {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to update remittance');
  return data;
}

export async function approveRemittance(id: number) {
  const response = await fetch(BASE_URL + `/remittances/${id}/approve`, {
    method: 'PUT',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to approve remittance');
  return data;
}

export async function deleteRemittance(id: number) {
  const response = await fetch(BASE_URL + `/remittances/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to delete remittance');
  return data;
}

export async function deleteCollection(id: number) {
  const response = await fetch(BASE_URL + `/collections/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Failed to delete collection');
  return data;
}
export async function updateCollection(collectionData: {
  id: number;
  customerName?: string;
  amount?: number;
  dueDate?: string;
  type?: string;
  status?: string;
  description?: string;
}) {
  const formData = new FormData();
  formData.append('id', String(collectionData.id));
  if (collectionData.customerName !== undefined) formData.append('customerName', collectionData.customerName);
  if (collectionData.amount !== undefined) formData.append('amount', String(collectionData.amount));
  if (collectionData.dueDate !== undefined) formData.append('dueDate', collectionData.dueDate);
  if (collectionData.type !== undefined) formData.append('type', collectionData.type);
  if (collectionData.status !== undefined) formData.append('status', collectionData.status);
  if (collectionData.description !== undefined) formData.append('description', collectionData.description);

  const response = await fetch(BASE_URL + '/collections', {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update collection');
  }
  return data;
}

// Wallet APIs
export async function getWalletBalance() {
  const response = await fetch(BASE_URL + '/wallet/balance', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(response, 'Failed to fetch wallet balance');
}

export async function createWalletTransaction(transactionData: { type: string; amount: number; description: string; }) {
  const formData = new FormData();
  formData.append('type', transactionData.type);
  formData.append('amount', String(transactionData.amount));
  formData.append('description', transactionData.description);
  
  const response = await fetch(BASE_URL + '/wallet/transactions', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create wallet transaction');
  }
  return data;
}

export async function fetchWalletTransactions() {
  const response = await fetch(BASE_URL + '/wallet/transactions', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch wallet transactions');
  }
  return data;
}

export async function transferToCustomer(transferData: { customerId: number; amount: number; description?: string; transactionType?: string; type?: 'credit' | 'debit'; paymentMethod?: string; }) {
  const response = await fetch(BASE_URL + '/wallet/transfer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(transferData),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'Failed to complete transfer');
  }

  return data;
}

export async function fetchWalletTiers() {
  const response = await fetch(BASE_URL + '/wallet-tiers', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch wallet tiers');
  }
  return data;
}

// Investment Application APIs
export async function createInvestmentApplication(applicationData: { 
  customerName: string; 
  accountNumber?: string; 
  targetAmount: number; 
  duration: number; 
  agentId?: number; 
  branch?: string; 
  notes?: string; 
}) {
  const formData = new FormData();
  formData.append('customerName', applicationData.customerName);
  if (applicationData.accountNumber) formData.append('accountNumber', applicationData.accountNumber);
  formData.append('targetAmount', String(applicationData.targetAmount));
  formData.append('duration', String(applicationData.duration));
  if (applicationData.agentId) formData.append('agentId', String(applicationData.agentId));
  if (applicationData.branch) formData.append('branch', applicationData.branch);
  if (applicationData.notes) formData.append('notes', applicationData.notes);
  
  const response = await fetch(BASE_URL + '/investment-applications', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create investment application');
  }
  return data;
}

export async function fetchInvestmentApplications(params?: { 
  status?: string; 
  search?: string; 
  fromDate?: string; 
  toDate?: string; 
  page?: number; 
  limit?: number; 
}) {
  const queryParams = new URLSearchParams();
  if (params?.status) queryParams.append('status', params.status);
  if (params?.search) queryParams.append('search', params.search);
  if (params?.fromDate) queryParams.append('fromDate', params.fromDate);
  if (params?.toDate) queryParams.append('toDate', params.toDate);
  if (params?.page) queryParams.append('page', String(params.page));
  if (params?.limit) queryParams.append('limit', String(params.limit));
  
  const response = await fetch(BASE_URL + '/investment-applications?' + queryParams.toString(), {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch investment applications');
  }
  return data;
}

export async function updateInvestmentApplicationStatus(id: number, statusData: { 
  status: string; 
  notes?: string; 
  rejectionReason?: string; 
}) {
  const formData = new FormData();
  formData.append('status', statusData.status);
  if (statusData.notes) formData.append('notes', statusData.notes);
  if (statusData.rejectionReason) formData.append('rejectionReason', statusData.rejectionReason);
  
  const response = await fetch(BASE_URL + `/investment-applications/${id}/status`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update application status');
  }
  return data;
}

export async function deleteInvestmentApplication(id: number) {
  const response = await fetch(BASE_URL + `/investment-applications/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to delete investment application');
  }
  return data;
}

export async function updateInvestmentApplication(id: number, applicationData: {
  targetAmount?: number;
  duration?: number;
  agentId?: number;
  branch?: string;
  notes?: string;
  status?: string;
}) {
  const formData = new FormData();
  if (applicationData.targetAmount !== undefined) formData.append('targetAmount', String(applicationData.targetAmount));
  if (applicationData.duration !== undefined) formData.append('duration', String(applicationData.duration));
  if (applicationData.agentId !== undefined) formData.append('agentId', String(applicationData.agentId));
  if (applicationData.branch !== undefined) formData.append('branch', applicationData.branch);
  if (applicationData.notes !== undefined) formData.append('notes', applicationData.notes);
  if (applicationData.status !== undefined) formData.append('status', applicationData.status);

  const response = await fetch(BASE_URL + `/investment-applications/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update investment application');
  }
  return data;
}

// Loan Application APIs
export async function createLoanApplication(applicationData: { 
  customerName: string; 
  accountNumber?: string; 
  requestedAmount: number; 
  interestRate: number;
  duration: number; 
  agentId?: number; 
  branch?: string; 
  notes?: string;
  purpose?: string;
  collateral?: string;
}) {
  const formData = new FormData();
  formData.append('customerName', applicationData.customerName);
  if (applicationData.accountNumber) formData.append('accountNumber', applicationData.accountNumber);
  formData.append('requestedAmount', String(applicationData.requestedAmount));
  formData.append('interestRate', String(applicationData.interestRate));
  formData.append('duration', String(applicationData.duration));
  if (applicationData.agentId) formData.append('agentId', String(applicationData.agentId));
  if (applicationData.branch) formData.append('branch', applicationData.branch);
  if (applicationData.notes) formData.append('notes', applicationData.notes);
  if (applicationData.purpose) formData.append('purpose', applicationData.purpose);
  if (applicationData.collateral) formData.append('collateral', applicationData.collateral);
  
  const response = await fetch(BASE_URL + '/loan-applications', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create loan application');
  }
  return data;
}

export async function fetchLoanApplications(params?: { 
  status?: string; 
  search?: string; 
  fromDate?: string; 
  toDate?: string; 
  page?: number; 
  limit?: number; 
}) {
  const queryParams = new URLSearchParams();
  if (params?.status) queryParams.append('status', params.status);
  if (params?.search) queryParams.append('search', params.search);
  if (params?.fromDate) queryParams.append('fromDate', params.fromDate);
  if (params?.toDate) queryParams.append('toDate', params.toDate);
  if (params?.page) queryParams.append('page', String(params.page));
  if (params?.limit) queryParams.append('limit', String(params.limit));
  
  const response = await fetch(BASE_URL + '/loan-applications?' + queryParams.toString(), {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch loan applications');
  }
  return data;
}

export async function updateLoanApplicationStatus(id: number, statusData: { 
  status: string; 
  notes?: string; 
  rejectionReason?: string; 
}) {
  const formData = new FormData();
  formData.append('status', statusData.status);
  if (statusData.notes) formData.append('notes', statusData.notes);
  if (statusData.rejectionReason) formData.append('rejectionReason', statusData.rejectionReason);
  
  const response = await fetch(BASE_URL + `/loan-applications/${id}/status`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update application status');
  }
  return data;
}

export async function deleteLoanApplication(id: number) {
  const response = await fetch(BASE_URL + `/loan-applications/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to delete loan application');
  }
  return data;
}

// Loan APIs
export async function createLoan(loanData: { 
  customerName: string; 
  accountNumber?: string; 
  loanAmount: number; 
  interestRate: number; 
  duration: number; 
  agentId?: number; 
  branch?: string; 
  notes?: string;
  dueDate: string;
  loanFormFile?: File;
  packageName?: string;
}) {
  const formData = new FormData();
  formData.append('customerName', loanData.customerName);
  if (loanData.accountNumber) formData.append('accountNumber', loanData.accountNumber);
  formData.append('loanAmount', String(loanData.loanAmount));
  formData.append('interestRate', String(loanData.interestRate));
  formData.append('duration', String(loanData.duration));
  if (loanData.agentId) formData.append('agentId', String(loanData.agentId));
  if (loanData.branch) formData.append('branch', loanData.branch);
  if (loanData.notes) formData.append('notes', loanData.notes);
  formData.append('dueDate', loanData.dueDate);
  if (loanData.loanFormFile) formData.append('loanForm', loanData.loanFormFile);
  if (loanData.packageName) formData.append('packageName', loanData.packageName);

  const response = await fetch(BASE_URL + '/loans', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create loan');
  }
  return data;
}

export async function fetchLoans(params: {
  status?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
  agentId?: string;
}) {
  const queryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) queryParams.append(key, value.toString());
  });

  const response = await fetch(BASE_URL + `/loans?${queryParams}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(response, 'Failed to fetch loans');
}

export async function fetchLoanById(id: number) {
  const response = await fetch(BASE_URL + `/loans/${id}` , {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch loan');
  }
  return data;
}

export async function updateLoanStatus(id: number, statusData: { status: string; notes?: string }) {
  const response = await fetch(BASE_URL + `/loans/${id}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(statusData),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update loan status');
  }
  return data;
}

export async function deleteLoan(id: number) {
  const response = await fetch(BASE_URL + `/loans/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to delete loan');
  }
  return data;
}

export async function fetchLoanStats() {
  const response = await fetch(BASE_URL + '/loans/stats/summary', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(response, 'Failed to fetch loan statistics');
}

// Repayment APIs
export async function createRepayment(repaymentData: { 
  loanId: number; 
  customerName: string; 
  accountNumber?: string; 
  package?: string; 
  amount: number; 
  branch?: string; 
  agentId?: number; 
  paymentMethod?: string; 
  reference?: string; 
  notes?: string;
}) {
  // Attach JSON content-type and collaborator merchant header if present
  let extraHeaders: Record<string, string> = {};
  try {
    const userStr = typeof window !== 'undefined' ? window.localStorage.getItem('user') : null;
    if (userStr) {
      const parsed = JSON.parse(userStr);
      const possibleMerchant = parsed?.merchantId || parsed?.id || parsed?.merchant?.id;
      if (possibleMerchant) {
        extraHeaders['x-merchant-id'] = String(possibleMerchant);
      }
    }
  } catch {}
  const response = await fetch(BASE_URL + '/repayments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...extraHeaders,
    },
    body: JSON.stringify(repaymentData),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create repayment');
  }
  return data;
}

export async function fetchRepayments(params: {
  status?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
  agentId?: string;
}) {
  const queryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) queryParams.append(key, value.toString());
  });

  const response = await fetch(BASE_URL + `/repayments?${queryParams}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch repayments');
  }
  return data;
}

export async function updateRepaymentStatus(id: number, statusData: { status: string; notes?: string }) {
  // Attach JSON content-type and merchant header if present
  let extraHeaders: Record<string, string> = {};
  try {
    const userStr = typeof window !== 'undefined' ? window.localStorage.getItem('user') : null;
    if (userStr) {
      const parsed = JSON.parse(userStr);
      const possibleMerchant = parsed?.merchantId || parsed?.id || parsed?.merchant?.id;
      if (possibleMerchant) {
        extraHeaders['x-merchant-id'] = String(possibleMerchant);
      }
    }
  } catch {}
  const response = await fetch(BASE_URL + `/repayments/${id}/status`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...extraHeaders,
    },
    body: JSON.stringify(statusData),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update repayment status');
  }
  return data;
}

export async function deleteRepayment(id: number) {
  const response = await fetch(BASE_URL + `/repayments/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to delete repayment');
  }
  return data;
}

export async function fetchRepaymentStats() {
  const response = await fetch(BASE_URL + '/repayments/stats/summary', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch repayment statistics');
  }
  return data;
}

// Dashboard Statistics API functions
export async function fetchDashboardStats() {
  const response = await fetch(BASE_URL + '/dashboard/stats', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch dashboard statistics');
  }
  return data;
}

export async function fetchTransactionStats(duration = 'Last 12 months') {
  const response = await fetch(BASE_URL + `/dashboard/transaction-stats?duration=${encodeURIComponent(duration)}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch transaction statistics');
  }
  return data;
}

export async function fetchAgentCustomerStats() {
  const response = await fetch(BASE_URL + '/dashboard/agent-customer-stats', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch agent-customer statistics');
  }
  return data;
}

// Customer Wallet APIs
export async function fetchCustomerWallets(params: {
  page?: number;
  limit?: number;
  search?: string;
  accountLevel?: string;
  status?: string;
}) {
  const queryParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) queryParams.append(key, value.toString());
  });

  const response = await fetch(BASE_URL + `/customer-wallets?${queryParams}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch customer wallets');
  }
  return data;
}

export async function fetchCustomerWalletTransactions(customerId: string | number) {
  const response = await fetch(BASE_URL + `/customer-wallets/${customerId}/transactions`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  return handleResponse(response, 'Failed to fetch customer wallet transactions');
}

export async function fetchCustomerWalletById(id: number) {
  const response = await fetch(BASE_URL + `/customer-wallets/${id}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch customer wallet');
  }
  return data;
}

export async function createCustomerWallet(walletData: {
  customerId: number;
  accountNumber?: string;
  accountLevel?: string;
  balance?: number;
  notes?: string;
}) {
  const response = await fetch(BASE_URL + '/customer-wallets', {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(walletData),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create customer wallet');
  }
  return data;
}

export async function updateCustomerWallet(id: number, walletData: {
  accountLevel?: string;
  balance?: number;
  status?: string;
  notes?: string;
}) {
  const response = await fetch(BASE_URL + `/customer-wallets/${id}`, {
    method: 'PUT',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(walletData),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update customer wallet');
  }
  return data;
}

export async function deleteCustomerWallet(id: number) {
  const response = await fetch(BASE_URL + `/customer-wallets/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to delete customer wallet');
  }
  return data;
}

export async function fetchCustomerWalletStats() {
  const response = await fetch(BASE_URL + '/customer-wallets/stats/summary', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch customer wallet statistics');
  }
  return data;
}

// Investment Transaction APIs
export async function createInvestmentTransaction(transactionData: {
  customer: string;
  accountNumber: string;
  package: string;
  amount: number;
  branch: string;
  agent: string;
  transactionType: 'deposit' | 'withdrawal' | 'interest' | 'penalty';
  notes?: string;
}) {
  const formData = new FormData();
  formData.append('customer', transactionData.customer);
  formData.append('accountNumber', transactionData.accountNumber);
  formData.append('package', transactionData.package);
  formData.append('amount', String(transactionData.amount));
  formData.append('branch', transactionData.branch);
  formData.append('agent', transactionData.agent);
  formData.append('transactionType', transactionData.transactionType);
  if (transactionData.notes) formData.append('notes', transactionData.notes);
  
  const response = await fetch(BASE_URL + '/investment-transactions', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create investment transaction');
  }
  return data;
}

export async function fetchInvestmentTransactions(params?: {
  status?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  limit?: number;
  agentId?: string;
  branch?: string;
  transactionType?: string;
}) {
  try {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.append('status', params.status);
    if (params?.search) queryParams.append('search', params.search);
    if (params?.fromDate) queryParams.append('fromDate', params.fromDate);
    if (params?.toDate) queryParams.append('toDate', params.toDate);
    if (params?.page) queryParams.append('page', String(params.page));
    if (params?.limit) queryParams.append('limit', String(params.limit));
    if (params?.agentId) queryParams.append('agentId', params.agentId);
    if (params?.branch) queryParams.append('branch', params.branch);
    if (params?.transactionType) queryParams.append('transactionType', params.transactionType);
    
    const url = BASE_URL + '/investment-transactions?' + queryParams.toString();
    
    const response = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.message || `Failed to fetch investment transactions (${response.status})`);
    }
    return data;
  } catch (error) {
    console.error('fetchInvestmentTransactions error:', error);
    throw error;
  }
}

export async function updateInvestmentTransaction(id: string, transactionData: {
  customer?: string;
  accountNumber?: string;
  package?: string;
  amount?: number;
  branch?: string;
  agent?: string;
  transactionType?: 'deposit' | 'withdrawal' | 'interest' | 'penalty';
  status?: 'pending' | 'completed' | 'cancelled';
  notes?: string;
}) {
  const formData = new FormData();
  if (transactionData.customer) formData.append('customer', transactionData.customer);
  if (transactionData.accountNumber) formData.append('accountNumber', transactionData.accountNumber);
  if (transactionData.package) formData.append('package', transactionData.package);
  if (transactionData.amount !== undefined) formData.append('amount', String(transactionData.amount));
  if (transactionData.branch) formData.append('branch', transactionData.branch);
  if (transactionData.agent) formData.append('agent', transactionData.agent);
  if (transactionData.transactionType) formData.append('transactionType', transactionData.transactionType);
  if (transactionData.status) formData.append('status', transactionData.status);
  if (transactionData.notes !== undefined) formData.append('notes', transactionData.notes);
  
  const response = await fetch(BASE_URL + `/investment-transactions/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update investment transaction');
  }
  return data;
}

export async function deleteInvestmentTransaction(id: string) {
  const response = await fetch(BASE_URL + `/investment-transactions/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to delete investment transaction');
  }
  return data;
}

export async function fetchInvestmentTransactionById(id: string) {
  const response = await fetch(BASE_URL + `/investment-transactions/${id}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch investment transaction');
  }
  return data;
}

// ==================== ACCOUNTING API FUNCTIONS ====================

// Account (COA) operations
export async function createAccount(accountData: any) {
  const formData = new FormData();
  if (accountData.code) formData.append('code', accountData.code);
  if (accountData.name) formData.append('name', accountData.name);
  if (accountData.type) formData.append('type', accountData.type);
  if (accountData.category) formData.append('category', accountData.category);
  if (accountData.balance !== undefined) formData.append('balance', String(accountData.balance));
  if (accountData.currency) formData.append('currency', accountData.currency);
  if (accountData.description) formData.append('description', accountData.description);

  const response = await fetch(BASE_URL + '/accounting/accounts', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create account');
  }
  return data;
}

export async function fetchAccounts(params?: { type?: string; category?: string; isActive?: boolean }) {
  const queryParams = new URLSearchParams();
  if (params?.type) queryParams.append('type', params.type);
  if (params?.category) queryParams.append('category', params.category);
  if (params?.isActive !== undefined) queryParams.append('isActive', String(params.isActive));

  const response = await fetch(BASE_URL + `/accounting/accounts?${queryParams.toString()}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch accounts');
  }
  return data;
}

export async function fetchAccountById(id: string) {
  const response = await fetch(BASE_URL + `/accounting/accounts/${id}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch account');
  }
  return data;
}

export async function updateAccount(accountData: any) {
  const formData = new FormData();
  if (accountData.id) formData.append('id', String(accountData.id));
  if (accountData.code) formData.append('code', accountData.code);
  if (accountData.name) formData.append('name', accountData.name);
  if (accountData.type) formData.append('type', accountData.type);
  if (accountData.category) formData.append('category', accountData.category);
  if (accountData.balance !== undefined) formData.append('balance', String(accountData.balance));
  if (accountData.currency) formData.append('currency', accountData.currency);
  if (accountData.description !== undefined) formData.append('description', accountData.description);
  if (accountData.isActive !== undefined) formData.append('isActive', String(accountData.isActive));

  const response = await fetch(BASE_URL + '/accounting/accounts', {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update account');
  }
  return data;
}

export async function deleteAccount(id: string) {
  const response = await fetch(BASE_URL + `/accounting/accounts/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to delete account');
  }
  return data;
}

// Journal Entry operations
export async function createJournalEntry(journalData: any) {
  const response = await fetch(BASE_URL + '/accounting/journal-entries', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify(journalData),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create journal entry');
  }
  return data;
}

export async function fetchJournalEntries(params?: { status?: string; dateFrom?: string; dateTo?: string }) {
  const queryParams = new URLSearchParams();
  if (params?.status) queryParams.append('status', params.status);
  if (params?.dateFrom) queryParams.append('dateFrom', params.dateFrom);
  if (params?.dateTo) queryParams.append('dateTo', params.dateTo);

  const response = await fetch(BASE_URL + `/accounting/journal-entries?${queryParams.toString()}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch journal entries');
  }
  return data;
}

export async function fetchJournalEntryById(id: string) {
  const response = await fetch(BASE_URL + `/accounting/journal-entries/${id}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch journal entry');
  }
  return data;
}

export async function postJournalEntry(id: string) {
  const response = await fetch(BASE_URL + `/accounting/journal-entries/${id}/post`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to post journal entry');
  }
  return data;
}

export async function reverseJournalEntry(id: string) {
  const response = await fetch(BASE_URL + `/accounting/journal-entries/${id}/reverse`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to reverse journal entry');
  }
  return data;
}

export async function deleteJournalEntry(id: string) {
  const response = await fetch(BASE_URL + `/accounting/journal-entries/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to delete journal entry');
  }
  return data;
}

// Ledger operations
export async function fetchGeneralLedger(params: { accountId: string; dateFrom?: string; dateTo?: string }) {
  const queryParams = new URLSearchParams();
  queryParams.append('accountId', params.accountId);
  if (params.dateFrom) queryParams.append('dateFrom', params.dateFrom);
  if (params.dateTo) queryParams.append('dateTo', params.dateTo);

  const response = await fetch(BASE_URL + `/accounting/ledger?${queryParams.toString()}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch ledger');
  }
  return data;
}

// Fiscal Period operations
export async function createFiscalPeriod(periodData: any) {
  const formData = new FormData();
  if (periodData.name) formData.append('name', periodData.name);
  if (periodData.startDate) formData.append('startDate', periodData.startDate);
  if (periodData.endDate) formData.append('endDate', periodData.endDate);

  const response = await fetch(BASE_URL + '/accounting/fiscal-periods', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to create fiscal period');
  }
  return data;
}

export async function fetchFiscalPeriods() {
  const response = await fetch(BASE_URL + '/accounting/fiscal-periods', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch fiscal periods');
  }
  return data;
}

export async function updateFiscalPeriod(id: string, periodData: any) {
  const formData = new FormData();
  if (periodData.name) formData.append('name', periodData.name);
  if (periodData.startDate) formData.append('startDate', periodData.startDate);
  if (periodData.endDate) formData.append('endDate', periodData.endDate);
  if (periodData.status) formData.append('status', periodData.status);

  const response = await fetch(BASE_URL + `/accounting/fiscal-periods/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update fiscal period');
  }
  return data;
}

// Report operations
export async function fetchTrialBalance(params?: { asOfDate?: string }) {
  const queryParams = new URLSearchParams();
  if (params?.asOfDate) queryParams.append('asOfDate', params.asOfDate);

  const response = await fetch(BASE_URL + `/accounting/reports/trial-balance?${queryParams.toString()}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch trial balance');
  }
  return data;
}

export async function fetchBalanceSheet(params?: { asOfDate?: string }) {
  const queryParams = new URLSearchParams();
  if (params?.asOfDate) queryParams.append('asOfDate', params.asOfDate);

  const response = await fetch(BASE_URL + `/accounting/reports/balance-sheet?${queryParams.toString()}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch balance sheet');
  }
  return data;
}

export async function fetchIncomeStatement(params?: { dateFrom?: string; dateTo?: string }) {
  const queryParams = new URLSearchParams();
  if (params?.dateFrom) queryParams.append('dateFrom', params.dateFrom);
  if (params?.dateTo) queryParams.append('dateTo', params.dateTo);

  const response = await fetch(BASE_URL + `/accounting/reports/income-statement?${queryParams.toString()}`, {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch income statement');
  }
  return data;
}

export async function fetchTransactionMappings() {
  const response = await fetch(BASE_URL + '/accounting/transaction-mappings', {
    method: 'GET',
    headers: getAuthHeaders(),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch transaction mappings');
  }
  return data;
}


