"use client";
import React, { useState, useEffect } from 'react';
import { FaTimes } from 'react-icons/fa';
import { fetchCustomers, fetchAgents, fetchPackages, createInvestmentApplication, updateInvestmentApplication } from '../../services/api';
import Swal from 'sweetalert2';

interface InvestmentApplicationFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editData?: any;
}

interface Customer {
  id: number;
  fullName: string;
  accountNumber?: string;
  agentId?: number;
  agentName?: string;
  branchName?: string;
  branch?: string;
}

interface Agent {
  id: number;
  fullName: string;
  branch: string;
}

const InvestmentApplicationForm: React.FC<InvestmentApplicationFormProps> = ({
  isOpen,
  onClose,
  onSuccess,
  editData
}) => {
  const [formData, setFormData] = useState({
    customerName: '',
    accountNumber: '',
    targetAmount: '',
    duration: '',
    agentId: '',
    branch: '',
    notes: ''
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([]);
  const [filteredAgents, setFilteredAgents] = useState<Agent[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);
  const [packages, setPackages] = useState<any[]>([]);
  const [selectedPackage, setSelectedPackage] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchData();
      if (editData) {
        setFormData({
          customerName: editData.customerName || '',
          accountNumber: editData.accountNumber || '',
          targetAmount: editData.targetAmount?.toString() || '',
          duration: editData.duration?.toString() || '',
          agentId: editData.agentId?.toString() || '',
          branch: editData.branch || '',
          notes: editData.notes || ''
        });
      } else {
        setFormData({
          customerName: '',
          accountNumber: '',
          targetAmount: '',
          duration: '',
          agentId: '',
          branch: '',
          notes: ''
        });
        setSelectedPackage('');
      }
    }
  }, [isOpen, editData]);

  const fetchData = async () => {
    try {
      const [customersRes, agentsRes, packagesRes] = await Promise.all([
        fetchCustomers().catch(() => ({ customers: [] })),
        fetchAgents().catch(() => ({ agents: [] })),
        fetchPackages('Investment').catch(() => ({ packages: [] }))
      ]);
      setCustomers(customersRes.customers || customersRes.data || (Array.isArray(customersRes) ? customersRes : []));
      setAgents(agentsRes.agents || agentsRes.data || (Array.isArray(agentsRes) ? agentsRes : []));
      const rawPackages = packagesRes.packages || packagesRes.data || packagesRes || [];
      const investmentPackages = Array.isArray(rawPackages)
        ? rawPackages.filter((p: any) => !p.packageCategory || p.packageCategory.toLowerCase() === 'investment')
        : [];
      setPackages(investmentPackages);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    }
  };

  // Determine if a customer is selected from the list
  const selectedCustomerObj = customers.find(
    c => c.fullName.trim().toLowerCase() === formData.customerName.trim().toLowerCase()
  );
  const isCustomerSelected = Boolean(selectedCustomerObj);

  // Determine if a package is selected from the dropdown
  const isPackageSelected = Boolean(selectedPackage);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    if (name === 'customerName') {
      const filtered = customers.filter(customer =>
        customer.fullName.toLowerCase().includes(value.toLowerCase())
      );
      setFilteredCustomers(filtered);
      setShowCustomerDropdown(value.length > 0);

      // Auto-fill agent & branch if exact match found
      const match = customers.find(c => c.fullName.toLowerCase() === value.trim().toLowerCase());
      if (match) {
        const matchingAgent = agents.find(a =>
          a.id === (match as any).agentId ||
          (a.fullName && (match as any).agentName && a.fullName.toLowerCase() === (match as any).agentName.toLowerCase())
        );
        setFormData(prev => ({
          ...prev,
          accountNumber: match.accountNumber || prev.accountNumber,
          agentId: matchingAgent ? matchingAgent.id.toString() : ((match as any).agentId ? String((match as any).agentId) : prev.agentId),
          branch: matchingAgent ? matchingAgent.branch : ((match as any).branchName || (match as any).branch || prev.branch)
        }));
      }
    }

    if (name === 'branch' && !isCustomerSelected) {
      const filtered = agents.filter(agent =>
        agent.branch.toLowerCase().includes(value.toLowerCase()) ||
        agent.fullName.toLowerCase().includes(value.toLowerCase())
      );
      setFilteredAgents(filtered);
      setShowAgentDropdown(value.length > 0);
    }
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    setShowCustomerDropdown(false);
    setShowAgentDropdown(false);
  };

  const handleCustomerPick = (customer: Customer) => {
    const matchingAgent = agents.find(a =>
      a.id === (customer as any).agentId ||
      (a.fullName && (customer as any).agentName && a.fullName.toLowerCase() === (customer as any).agentName.toLowerCase())
    );

    const agentIdVal = matchingAgent ? matchingAgent.id.toString() : ((customer as any).agentId ? String((customer as any).agentId) : '');
    const branchVal = matchingAgent ? matchingAgent.branch : ((customer as any).branchName || (customer as any).branch || '');

    setFormData(prev => ({
      ...prev,
      customerName: customer.fullName,
      accountNumber: customer.accountNumber || '',
      agentId: agentIdVal,
      branch: branchVal
    }));
    setShowCustomerDropdown(false);
  };

  const handlePackageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pkgId = e.target.value;
    setSelectedPackage(pkgId);
    if (pkgId) {
      const pkg = packages.find(p => p.id.toString() === pkgId);
      if (pkg) {
        const amountVal = pkg.amount ?? pkg.targetAmount ?? pkg.seedAmount ?? '';
        const durationVal = pkg.duration ?? pkg.period ?? '';
        setFormData(prev => ({
          ...prev,
          targetAmount: amountVal ? String(amountVal) : prev.targetAmount,
          duration: durationVal ? String(durationVal) : prev.duration
        }));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.customerName || !formData.targetAmount || !formData.duration) {
      Swal.fire({
        icon: 'warning',
        title: 'Missing Information',
        text: 'Please fill in all required fields.'
      });
      return;
    }

    setLoading(true);
    try {
      const applicationData = {
        customerName: formData.customerName,
        accountNumber: formData.accountNumber || undefined,
        targetAmount: parseFloat(formData.targetAmount),
        duration: parseInt(formData.duration),
        agentId: formData.agentId ? parseInt(formData.agentId) : undefined,
        branch: formData.branch || undefined,
        notes: formData.notes || undefined
      };

      if (editData?.id) {
        await updateInvestmentApplication(editData.id, {
          targetAmount: applicationData.targetAmount,
          duration: applicationData.duration,
          agentId: applicationData.agentId,
          branch: applicationData.branch,
          notes: applicationData.notes,
        });
      } else {
        await createInvestmentApplication(applicationData);
      }
      
      Swal.fire({
        icon: 'success',
        title: 'Success',
        text: 'Investment application created successfully!'
      });
      
      onSuccess();
      onClose();
    } catch (error: any) {
      Swal.fire({
        icon: 'error',
        title: 'Error',
        text: error.message || 'Failed to create investment application'
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const currentAgentName = agents.find(a => a.id.toString() === formData.agentId)?.fullName || (selectedCustomerObj as any)?.agentName || '';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">
            {editData ? 'Edit Investment Application' : 'Create Investment Application'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <FaTimes size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Customer Name */}
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Customer Name *
              </label>
              <input
                type="text"
                name="customerName"
                value={formData.customerName}
                onChange={handleInputChange}
                placeholder="Search customer..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              {showCustomerDropdown && filteredCustomers.length > 0 && (
                <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-40 overflow-y-auto">
                  {filteredCustomers.map((customer) => (
                    <div
                      key={customer.id}
                      onClick={() => handleCustomerPick(customer)}
                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer"
                    >
                      {customer.fullName}{customer.accountNumber ? ` • ${customer.accountNumber}` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Account Number */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Account Number
              </label>
              <input
                type="text"
                name="accountNumber"
                value={formData.accountNumber}
                onChange={handleInputChange}
                placeholder="Account number"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Package Selection */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Investment Package
              </label>
              <select
                value={selectedPackage}
                onChange={handlePackageChange}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white ${
                  packages.length === 0 ? 'border-amber-300 text-amber-800 bg-amber-50' : 'border-gray-300'
                }`}
              >
                {packages.length === 0 ? (
                  <option value="">No Investment package created yet</option>
                ) : (
                  <>
                    <option value="">Select a package to auto-fill target amount & duration...</option>
                    {packages.map(pkg => (
                      <option key={pkg.id} value={pkg.id}>
                        {pkg.name} {pkg.amount ? `(₦${Number(pkg.amount).toLocaleString()} - ${pkg.duration || pkg.period || 360} days)` : ''}
                      </option>
                    ))}
                  </>
                )}
              </select>
              {packages.length === 0 && (
                <p className="text-xs text-amber-700 mt-1.5 flex items-center gap-1">
                  <span>⚠️</span> No Investment packages found. Please create an Investment package under <strong>Package &gt; Investment</strong> before applying.
                </p>
              )}
            </div>

            {/* Target Amount */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center justify-between">
                <span>Target Amount *</span>
                {isPackageSelected && <span className="text-xs text-indigo-600 font-normal">🔒 Locked (from package)</span>}
              </label>
              <input
                type="number"
                name="targetAmount"
                value={formData.targetAmount}
                onChange={handleInputChange}
                placeholder="0.00"
                min="0"
                step="0.01"
                required
                readOnly={isPackageSelected}
                className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isPackageSelected ? 'bg-gray-100 text-gray-700 cursor-not-allowed font-medium' : ''
                }`}
              />
            </div>

            {/* Duration */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center justify-between">
                <span>Duration (Days) *</span>
                {isPackageSelected && <span className="text-xs text-indigo-600 font-normal">🔒 Locked (from package)</span>}
              </label>
              <input
                type="number"
                name="duration"
                value={formData.duration}
                onChange={handleInputChange}
                placeholder="30"
                min="1"
                required
                readOnly={isPackageSelected}
                className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isPackageSelected ? 'bg-gray-100 text-gray-700 cursor-not-allowed font-medium' : ''
                }`}
              />
            </div>

            {/* Agent */}
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center justify-between">
                <span>Agent</span>
                {isCustomerSelected && <span className="text-xs text-indigo-600 font-normal">🔒 Locked (customer's agent)</span>}
              </label>
              <input
                type="text"
                value={currentAgentName}
                onChange={(e) => {
                  if (isCustomerSelected) return;
                  const term = e.target.value.toLowerCase();
                  const filtered = agents.filter(agent =>
                    agent.fullName.toLowerCase().includes(term) || agent.branch.toLowerCase().includes(term)
                  );
                  setFilteredAgents(filtered);
                  setShowAgentDropdown(e.target.value.length > 0);
                }}
                readOnly={isCustomerSelected}
                placeholder={isCustomerSelected ? "Auto-filled" : "Search agent or branch..."}
                className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isCustomerSelected ? 'bg-gray-100 text-gray-700 cursor-not-allowed font-medium' : ''
                }`}
              />
              {!isCustomerSelected && showAgentDropdown && filteredAgents.length > 0 && (
                <div className="absolute z-10 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-40 overflow-y-auto">
                  {filteredAgents.map((agent) => (
                    <div
                      key={agent.id}
                      onClick={() => {
                        handleSelectChange('agentId', agent.id.toString());
                        setFormData(prev => ({ ...prev, branch: agent.branch }));
                      }}
                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer"
                    >
                      {agent.fullName} - {agent.branch}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Branch */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center justify-between">
                <span>Branch</span>
                {isCustomerSelected && <span className="text-xs text-indigo-600 font-normal">🔒 Locked (customer's branch)</span>}
              </label>
              <input
                type="text"
                name="branch"
                value={formData.branch}
                onChange={handleInputChange}
                placeholder="Branch name"
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-100 text-gray-700 cursor-not-allowed font-medium"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleInputChange}
              placeholder="Additional notes..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {loading ? 'Creating...' : editData ? 'Update' : 'Create Application'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default InvestmentApplicationForm;
