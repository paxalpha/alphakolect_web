"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, Trash2, Pencil, Building, User, Mail, Phone, Briefcase, FileText, CheckCircle, Edit, ChevronDown } from 'lucide-react';
import { createRole, fetchRoles, updateRole, createStaff, listStaff, updateStaff, fetchBranches } from '@/services/api';
import Swal from 'sweetalert2';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PermissionLevel {
  view: boolean;
  edit: boolean;
}

type PermissionsMap = Record<string, PermissionLevel>;

/** Convert a PermissionsMap to the API-friendly `{ module: "Can edit" }` format */
const permissionsMapToApi = (map: PermissionsMap): Record<string, string> =>
  Object.fromEntries(
    Object.entries(map).map(([mod, { view, edit }]) => {
      if (edit) return [mod, "Can edit"];
      if (view) return [mod, "Can view only"];
      return [mod, "Can't view"];
    })
  );

/** Convert API format `{ module: "Can edit" }` → PermissionsMap */
const apiToPermissionsMap = (api: Record<string, string> | null | undefined): PermissionsMap => {
  const defaults = buildDefaultPermissionsMap();
  if (!api || typeof api !== 'object') return defaults;
  const result: PermissionsMap = { ...defaults };
  for (const [mod, level] of Object.entries(api)) {
    result[mod] = {
      view: level === "Can view only" || level === "Can edit",
      edit: level === "Can edit",
    };
  }
  return result;
};

const ALL_MODULES = [
  'dashboard',
  'accounting',
  'branch',
  'collection',
  'loan',
  'investments',
  'agents',
  'packages',
  'customers',
  'wallet',
  'charges',
  'staff_management',
] as const;

type Module = typeof ALL_MODULES[number];

const MODULE_LABELS: Record<Module, string> = {
  dashboard: 'Dashboard',
  accounting: 'Accounting',
  branch: 'Branch',
  collection: 'Collection',
  loan: 'Loan',
  investments: 'Investments',
  agents: 'Agents',
  packages: 'Packages',
  customers: 'Customers',
  wallet: 'Wallet',
  charges: 'Charges',
  staff_management: 'Staff Management',
};

const buildDefaultPermissionsMap = (): PermissionsMap =>
  Object.fromEntries(ALL_MODULES.map((m) => [m, { view: false, edit: false }])) as PermissionsMap;

interface Role {
  id: number;
  roleId: string;
  roleName: string;
  cantView: number;
  canViewOnly: number;
  canEdit: number;
  permissions?: Record<string, string>;
  lastUpdated: string;
  dateCreated: string;
}

interface StaffData {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  date: string;
  status: string;
}

// ─── Permission Checkboxes Table ─────────────────────────────────────────────

const PermissionTable: React.FC<{
  permissions: PermissionsMap;
  onChange: (module: string, level: 'view' | 'edit', checked: boolean) => void;
}> = ({ permissions, onChange }) => {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50 text-gray-600 uppercase text-xs">
            <th className="text-left py-2 px-3 font-semibold">Module</th>
            <th className="text-center py-2 px-3 font-semibold w-20">View</th>
            <th className="text-center py-2 px-3 font-semibold w-20">Edit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ALL_MODULES.map((mod) => {
            const perm = permissions[mod] || { view: false, edit: false };
            return (
              <tr key={mod} className="hover:bg-indigo-50/30 transition-colors">
                <td className="py-2.5 px-3 capitalize text-gray-700 font-medium">
                  {MODULE_LABELS[mod]}
                </td>
                {/* View checkbox */}
                <td className="py-2.5 px-3 text-center">
                  <input
                    type="checkbox"
                    id={`${mod}-view`}
                    className="w-4 h-4 rounded accent-indigo-600 cursor-pointer"
                    checked={perm.view || perm.edit}
                    onChange={(e) => onChange(mod, 'view', e.target.checked)}
                  />
                </td>
                {/* Edit checkbox */}
                <td className="py-2.5 px-3 text-center">
                  <input
                    type="checkbox"
                    id={`${mod}-edit`}
                    className="w-4 h-4 rounded accent-indigo-600 cursor-pointer"
                    checked={perm.edit}
                    onChange={(e) => onChange(mod, 'edit', e.target.checked)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-gray-400 mt-2 px-1">
        ✓ <strong>View</strong> = can view only &nbsp;|&nbsp; ✓ <strong>Edit</strong> = full access (implies view)
      </p>
    </div>
  );
};

// ─── Reusable form fields ─────────────────────────────────────────────────────

const FormInput = ({
  label, name, type, placeholder, value, onChange, icon: Icon,
}: {
  label: string; name: string; type: string; placeholder: string;
  value: string | number; onChange: (e: any) => void; icon: React.ElementType;
}) => (
  <div className="mb-4">
    <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    <div className="relative rounded-md shadow-sm">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        {Icon && <Icon className="h-5 w-5 text-gray-400" />}
      </div>
      <input
        type={type} name={name} id={name} value={value} onChange={onChange}
        className="block w-full rounded-md border-gray-300 pl-10 pr-3 py-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        placeholder={placeholder} required
      />
    </div>
  </div>
);

const FormSelect = ({
  label, name, options, value, onChange, icon: Icon,
}: {
  label: string; name: string; options: { value: string; label: string }[];
  value: string; onChange: (e: any) => void; icon: React.ElementType;
}) => (
  <div className="mb-4">
    <label htmlFor={name} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    <div className="relative rounded-md shadow-sm">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        {Icon && <Icon className="h-5 w-5 text-gray-400" />}
      </div>
      <select
        id={name} name={name} value={value} onChange={onChange}
        className="block w-full rounded-md border-gray-300 pl-10 pr-10 py-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        required
      >
        <option value="" disabled>Select {label.toLowerCase()}</option>
        {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </div>
  </div>
);

// ─── Edit Staff Modal ─────────────────────────────────────────────────────────

const EditStaffModal = ({
  isOpen, onClose, staffData, onSave,
}: {
  isOpen: boolean; onClose: () => void;
  staffData: StaffData | null; onSave: (data: StaffData) => void;
}) => {
  const [formData, setFormData] = useState<StaffData>({ id: '', name: '', email: '', phone: '', role: '', date: '', status: '' });
  const [password, setPassword] = useState('');
  const [roleOptions, setRoleOptions] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    if (staffData) {
      setFormData(staffData);
      setPassword('');
    }
    (async () => {
      try {
        const data = await fetchRoles();
        const roles = (Array.isArray(data) ? data : data?.roles || []) as any[];
        const opts = roles.map((r: any) => ({ value: String(r.id), label: r.roleName }));
        setRoleOptions(opts);
        if (staffData?.role) {
          const match = opts.find((o: any) => o.label === staffData.role);
          if (match) setFormData((prev) => ({ ...prev, role: match.value }));
        }
      } catch { setRoleOptions([]); }
    })();
  }, [isOpen, staffData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    setSaving(true);
    try {
      const selectedRole = roleOptions.find((r) => r.value === formData.role);
      await updateStaff({
        id: Number(formData.id), branch: '',
        fullName: formData.name, email: formData.email,
        phoneNumber: formData.phone, role: selectedRole ? selectedRole.label : formData.role,
        roleId: formData.role,
        status: formData.status || 'Active',
        ...(password.trim() ? { password: password.trim() } : {}),
      });
      Swal.fire({ icon: 'success', title: 'Staff updated', text: 'The staff member was updated successfully.' });
      onSave(formData);
      onClose();
      try { document.dispatchEvent(new CustomEvent('staff-created')); } catch {}
    } catch (err: any) {
      Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Failed to update staff.' });
    } finally { setSaving(false); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center">
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-lg w-full">
        <div className="flex justify-between items-center border-b pb-4 mb-4">
          <h2 className="text-xl font-semibold">Edit Staff Member</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
        </div>
        <div className="space-y-4">
          {[
            { label: 'Full Name', name: 'name', type: 'text' },
            { label: 'Email', name: 'email', type: 'email' },
            { label: 'Phone Number', name: 'phone', type: 'tel' },
          ].map(({ label, name, type }) => (
            <div key={name}>
              <label className="block text-sm font-medium text-gray-700">{label}</label>
              <input
                type={type} name={name} value={(formData as any)[name]} onChange={handleChange}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
              />
            </div>
          ))}
          <div>
            <label className="block text-sm font-medium text-gray-700">Role</label>
            <select
              name="role"
              value={formData.role}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
            >
              <option value="" disabled>Select role</option>
              {roleOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">New Password <span className="text-xs text-gray-400 font-normal">(Leave blank to keep unchanged)</span></label>
            <input
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter new password"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end space-x-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-60" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Create Sidebar ───────────────────────────────────────────────────────────

const CreateSidebar: React.FC<{ isOpen: boolean; onClose: () => void; type: 'staff' | 'role' }> = ({ isOpen, onClose, type }) => {
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [staffFormData, setStaffFormData] = useState({ branch: '', fullName: '', email: '', phoneNumber: '', role: '', password: '' });
  const [branchOptions, setBranchOptions] = useState<{ value: string; label: string }[]>([]);
  const [roleOptions, setRoleOptions] = useState<{ value: string; label: string }[]>([]);

  // Role form
  const [roleName, setRoleName] = useState('');
  const [permissions, setPermissions] = useState<PermissionsMap>(buildDefaultPermissionsMap());

  const handleCheckboxChange = (mod: string, level: 'view' | 'edit', checked: boolean) => {
    setPermissions((prev) => {
      const cur = prev[mod] || { view: false, edit: false };
      let next: PermissionLevel;
      if (level === 'edit') {
        // Checking edit also implies view; unchecking edit keeps view
        next = { view: checked ? true : cur.view, edit: checked };
      } else {
        // Unchecking view also unchecks edit
        next = { view: checked, edit: checked ? cur.edit : false };
      }
      return { ...prev, [mod]: next };
    });
  };

  // Fetch branches for staff form
  useEffect(() => {
    if (!isOpen || type !== 'staff') return;
    (async () => {
      try {
        const data = await fetchBranches();
        setBranchOptions((data?.branches || data || []).map((b: any) => ({ value: String(b.id ?? b.name), label: b.name })));
      } catch { setBranchOptions([]); }
    })();
  }, [isOpen, type]);

  // Fetch roles for staff form
  const fetchRoleOptions = async () => {
    try {
      const data = await fetchRoles();
      const roles = (Array.isArray(data) ? data : data?.roles || []) as any[];
      setRoleOptions(roles.map((r: any) => ({ value: String(r.id), label: r.roleName })));
    } catch { setRoleOptions([]); }
  };
  useEffect(() => { if (!isOpen || type !== 'staff') return; fetchRoleOptions(); }, [isOpen, type]);
  useEffect(() => {
    if (!isOpen || type !== 'staff') return;
    const h = () => fetchRoleOptions();
    document.addEventListener('role-created', h);
    return () => document.removeEventListener('role-created', h);
  }, [isOpen, type]);

  // Reset forms on open
  useEffect(() => {
    if (!isOpen) return;
    if (type === 'staff') {
      setStaffFormData({ branch: '', fullName: '', email: '', phoneNumber: '', role: '', password: '' });
    } else {
      setRoleName('');
      setPermissions(buildDefaultPermissionsMap());
    }
  }, [isOpen, type]);

  const handleStaffChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setStaffFormData((prev) => ({ ...prev, [name]: value }));
  };

  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);

  const handleStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffLoading(true);
    setStaffError(null);
    try {
      await createStaff(staffFormData);
      Swal.fire({ icon: 'success', title: 'Staff created', text: 'The staff member was created successfully.' });
      setStaffFormData({ branch: '', fullName: '', email: '', phoneNumber: '', role: '', password: '' });
      onClose();
      try {
        document.dispatchEvent(new CustomEvent('staff-created'));
        document.dispatchEvent(new CustomEvent('role-created'));
      } catch {}
    } catch (err: any) {
      setStaffError(err.message || 'Failed to create staff');
      Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Failed to create staff.' });
    } finally { setStaffLoading(false); }
  };

  const handleRoleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoleLoading(true);
    setRoleError(null);
    const apiPermissions = permissionsMapToApi(permissions);
    const cantViewCount = Object.values(apiPermissions).filter((v) => v === "Can't view").length;
    const canViewOnlyCount = Object.values(apiPermissions).filter((v) => v === "Can view only").length;
    const canEditCount = Object.values(apiPermissions).filter((v) => v === "Can edit").length;
    try {
      await createRole({ roleName, cantView: cantViewCount, canViewOnly: canViewOnlyCount, canEdit: canEditCount, permissions: apiPermissions });
      Swal.fire({ icon: 'success', title: 'Role created', text: 'The role was created successfully.' });
      setRoleName('');
      setPermissions(buildDefaultPermissionsMap());
      onClose();
      try { document.dispatchEvent(new CustomEvent('role-created')); } catch {}
    } catch (err: any) {
      setRoleError(err.message || 'Failed to create role');
      Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Failed to create role.' });
    } finally { setRoleLoading(false); }
  };

  return (
    <>
      <div
        className={`fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <div
        className={`fixed inset-y-0 right-0 w-full sm:max-w-md bg-white shadow-xl z-50 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'} flex flex-col`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">
            {type === 'staff' ? 'Create staff' : 'Create role'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Staff form */}
        {type === 'staff' && (
          <form onSubmit={handleStaffSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
            <FormSelect label="Branch" name="branch" icon={Building} value={staffFormData.branch} onChange={handleStaffChange} options={branchOptions} />
            <FormInput label="Full name" name="fullName" type="text" placeholder="John Doe" icon={User} value={staffFormData.fullName} onChange={handleStaffChange} />
            <FormInput label="Email" name="email" type="email" placeholder="johndoe@gmail.com" icon={Mail} value={staffFormData.email} onChange={handleStaffChange} />
            <FormInput label="Phone number" name="phoneNumber" type="tel" placeholder="+2347056454546" icon={Phone} value={staffFormData.phoneNumber} onChange={handleStaffChange} />
            <FormSelect label="Role" name="role" icon={Briefcase} value={staffFormData.role} onChange={handleStaffChange} options={roleOptions} />
            <FormInput label="Password (login password)" name="password" type="password" placeholder="Leave blank for default: Staff123!" icon={FileText} value={staffFormData.password} onChange={handleStaffChange} />
            <div className="pt-2">
              <button type="submit" className="w-full px-4 py-2 bg-indigo-600 text-white rounded-md font-semibold hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:opacity-60" disabled={staffLoading}>
                {staffLoading ? 'Creating...' : 'Create user'}
              </button>
              <p className="text-xs text-gray-500 mt-2">If no password is set, default will be <strong>Staff123!</strong></p>
              {staffError && <div className="text-red-600 text-sm mt-2">{staffError}</div>}
            </div>
          </form>
        )}

        {/* Role form */}
        {type === 'role' && (
          <form onSubmit={handleRoleSubmit} className="flex-1 overflow-y-auto p-6">
            <div className="mb-5">
              <label htmlFor="role-name" className="block text-sm font-medium text-gray-700 mb-2">Role name</label>
              <input
                type="text" id="role-name" value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                placeholder="Enter role name"
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <h3 className="text-base font-semibold text-gray-800 mb-3">Access permissions</h3>
              <PermissionTable permissions={permissions} onChange={handleCheckboxChange} />
            </div>

            <div className="pt-5">
              <button
                type="submit"
                className="w-full px-4 py-2 bg-indigo-600 text-white rounded-md font-semibold hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:opacity-60"
                disabled={roleLoading}
              >
                {roleLoading ? 'Creating...' : 'Create role'}
              </button>
              {roleError && <div className="text-red-600 text-sm mt-2">{roleError}</div>}
            </div>
          </form>
        )}
      </div>
    </>
  );
};

// ─── Edit Role Sidebar ────────────────────────────────────────────────────────

const EditRoleSidebar: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  initialRole: any;
  onSave: (data: any) => void;
}> = ({ isOpen, onClose, initialRole, onSave }) => {
  const [roleName, setRoleName] = useState('');
  const [permissions, setPermissions] = useState<PermissionsMap>(buildDefaultPermissionsMap());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate form when initialRole changes
  useEffect(() => {
    if (initialRole) {
      setRoleName(initialRole.roleName || '');
      setPermissions(apiToPermissionsMap(initialRole.permissions));
    }
  }, [initialRole]);

  const handleCheckboxChange = (mod: string, level: 'view' | 'edit', checked: boolean) => {
    setPermissions((prev) => {
      const cur = prev[mod] || { view: false, edit: false };
      let next: PermissionLevel;
      if (level === 'edit') {
        next = { view: checked ? true : cur.view, edit: checked };
      } else {
        next = { view: checked, edit: checked ? cur.edit : false };
      }
      return { ...prev, [mod]: next };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const apiPermissions = permissionsMapToApi(permissions);
    const cantViewCount = Object.values(apiPermissions).filter((v) => v === "Can't view").length;
    const canViewOnlyCount = Object.values(apiPermissions).filter((v) => v === "Can view only").length;
    const canEditCount = Object.values(apiPermissions).filter((v) => v === "Can edit").length;
    const payload = {
      id: initialRole.id,
      roleName,
      cantView: cantViewCount,
      canViewOnly: canViewOnlyCount,
      canEdit: canEditCount,
      permissions: apiPermissions,
    };
    try {
      await updateRole(payload);
      Swal.fire({ icon: 'success', title: 'Role updated', text: 'The role was updated successfully.' });
      onSave(payload);
      onClose();
      try { document.dispatchEvent(new CustomEvent('role-created')); } catch {}
    } catch (err: any) {
      setError(err.message || 'Failed to update role');
      Swal.fire({ icon: 'error', title: 'Error', text: err.message || 'Failed to update role.' });
    } finally { setLoading(false); }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className={`fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <div
        className={`fixed inset-y-0 right-0 w-full sm:max-w-md bg-white shadow-xl z-50 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'} flex flex-col`}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800">Edit role</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
          <div className="mb-5">
            <label htmlFor="edit-role-name" className="block text-sm font-medium text-gray-700 mb-2">Role name</label>
            <input
              type="text" id="edit-role-name" value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              placeholder="Enter name"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>

          <div>
            <h3 className="text-base font-semibold text-gray-800 mb-3">Access permissions</h3>
            <PermissionTable permissions={permissions} onChange={handleCheckboxChange} />
          </div>

          <div className="pt-5">
            <button
              type="submit"
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded-md font-semibold hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:opacity-60"
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save changes'}
            </button>
            {error && <div className="text-red-600 text-sm mt-2">{error}</div>}
          </div>
        </form>
      </div>
    </>
  );
};

// ─── Main Staff Page ──────────────────────────────────────────────────────────

export default function StaffPage() {
  const [isEditRoleOpen, setIsEditRoleOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [tab, setTab] = useState("members");
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [roleDropdownId, setRoleDropdownId] = useState<number | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarType, setSidebarType] = useState<'staff' | 'role'>('staff');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffData | null>(null);

  const openSidebar = (type: 'staff' | 'role') => { setSidebarType(type); setIsSidebarOpen(true); };
  const closeSidebar = () => setIsSidebarOpen(false);

  const handleEditRole = (role: Role) => {
    setSelectedRole(role);
    setIsEditRoleOpen(true);
  };

  const handleSaveRole = async (updatedRole: any) => {
    try { document.dispatchEvent(new CustomEvent('role-created')); } catch {}
  };

  // ── Staff data ──
  const [staff, setStaff] = useState<StaffData[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStaff = async () => {
      setStaffLoading(true);
      setStaffError(null);
      try {
        const data = await listStaff();
        const raw = Array.isArray(data) ? data : (data?.staff || []);
        setStaff(raw.map((s: any) => ({
          id: String(s.id),
          name: s.fullName,
          email: s.email,
          phone: s.phoneNumber,
          role: s?.Role?.roleName || s.role,
          date: s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '',
          status: s.status || 'Active',
        })));
      } catch (err: any) {
        setStaffError(err.message || 'Failed to fetch staff');
      } finally { setStaffLoading(false); }
    };
    fetchStaff();
    const h = () => fetchStaff();
    document.addEventListener('staff-created', h as any);
    document.addEventListener('role-created', h as any);
    return () => { document.removeEventListener('staff-created', h as any); document.removeEventListener('role-created', h as any); };
  }, []);

  // ── Roles data ──
  const [rolesData, setRolesData] = useState<Role[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [rolesError, setRolesError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setRolesLoading(true);
      setRolesError(null);
      try {
        const data = await fetchRoles();
        const raw = Array.isArray(data) ? data : (data?.roles || []);
        setRolesData(raw.map((r: any) => ({
          id: r.id,
          roleId: String(r.id),
          roleName: r.roleName,
          cantView: r.cantView ?? 0,
          canViewOnly: r.canViewOnly ?? 0,
          canEdit: r.canEdit ?? 0,
          permissions: r.permissions || {},
          lastUpdated: r.updatedAt ? new Date(r.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '',
          dateCreated: r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '',
        })));
      } catch (err: any) {
        setRolesError(err.message || 'Failed to fetch roles');
      } finally { setRolesLoading(false); }
    };
    fetchData();
    const h = () => fetchData();
    document.addEventListener('role-created', h as any);
    return () => document.removeEventListener('role-created', h as any);
  }, []);

  const [sortConfig, setSortConfig] = useState<{ key: keyof Role; direction: 'ascending' | 'descending' } | null>(null);

  const sortedRoles = useMemo(() => {
    const sortable = [...rolesData];
    if (sortConfig) {
      const cfg = sortConfig; // capture to satisfy TS null-narrowing inside callback
      sortable.sort((a, b) => {
        const aVal = a[cfg.key];
        const bVal = b[cfg.key];
        if (aVal === undefined || bVal === undefined) return 0;
        if (aVal < bVal) return cfg.direction === 'ascending' ? -1 : 1;
        if (aVal > bVal) return cfg.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    return sortable;
  }, [rolesData, sortConfig]);

  const requestSort = (key: keyof Role) => {
    setSortConfig((prev) => ({
      key,
      direction: prev?.key === key && prev.direction === 'ascending' ? 'descending' : 'ascending',
    }));
  };

  const getSortIcon = (key: keyof Role) => {
    if (!sortConfig || sortConfig.key !== key) return null;
    return sortConfig.direction === 'ascending'
      ? <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
      : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>;
  };

  const roleDropdownOptions = (id: number) => setRoleDropdownId(roleDropdownId === id ? null : id);
  const handleRoleDeletion = (id: number) => { console.log(`Deleting role ${id}`); setRoleDropdownId(null); };

  const dropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setRoleDropdownId(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleEditStaff(s: StaffData) { setSelectedStaff(s); setIsEditModalOpen(true); }
  async function handleSaveStaff(_: StaffData) {
    try {
      const data = await listStaff();
      setStaff(Array.isArray(data) ? data : data.staff || []);
    } catch {}
    setIsEditModalOpen(false);
  }

  const [search, setSearch] = useState('');
  const filteredStaff = useMemo(() => {
    if (!search) return staff;
    const term = search.toLowerCase();
    return staff.filter((s) =>
      (s.name || '').toLowerCase().includes(term) ||
      (s.email || '').toLowerCase().includes(term) ||
      (s.phone || '').toLowerCase().includes(term) ||
      (s.role || '').toLowerCase().includes(term)
    );
  }, [staff, search]);

  const handleExport = (format: string) => {
    if (format === 'CSV') {
      const headers = ['Staff ID', 'Name', 'Email', 'Phone', 'Role', 'Status', 'Date Added'];
      const rows = filteredStaff.map((s) => [s.id, s.name, s.email, s.phone, s.role, s.status, s.date]);
      const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `staff_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } else if (format === 'PDF') { window.print(); }
  };

  const totalPages = Math.ceil(filteredStaff.length / itemsPerPage) || 1;
  const pagedStaff = filteredStaff.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="min-h-screen font-[Inter]">
      <div className="flex flex-col md:flex-row pt-3 justify-between md:items-center mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">Staff management</h1>
          <p className="text-gray-500 text-sm">Manage and monitor all platform staff.</p>
        </div>
        <button
          type="button"
          onClick={() => openSidebar(tab === 'members' ? 'staff' : 'role')}
          className="px-4 py-2 mt-4 md:mt-0 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium flex items-center justify-center w-full md:w-auto"
        >
          <Plus className="mr-2" /> {tab === 'members' ? 'Create staff' : 'Create role'}
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {/* Tabs */}
        <div className="border-b px-4 pt-4">
          <nav className="flex space-x-6 text-sm font-medium">
            <button onClick={() => setTab('members')} className={tab === 'members' ? 'text-indigo-600 border-b-2 border-indigo-600 pb-2' : 'text-gray-500 hover:text-gray-700 pb-2'}>
              Staff members
            </button>
            <button onClick={() => setTab('roles')} className={tab === 'roles' ? 'text-indigo-600 border-b-2 border-indigo-600 pb-2' : 'text-gray-500 hover:text-gray-700 pb-2'}>
              Roles
            </button>
          </nav>
        </div>

        {/* ── Staff members tab ── */}
        {tab === 'members' && (
          <>
            <div className="p-4 flex flex-col md:flex-row justify-between gap-4">
              <div className="flex items-center gap-2">
                <button className="border border-gray-300 text-sm px-3 py-1.5 rounded hover:bg-gray-50 flex items-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                  Filter
                </button>
                <select className="text-sm border border-gray-300 rounded px-2 py-1" value={itemsPerPage} onChange={(e) => { setItemsPerPage(parseInt(e.target.value)); setCurrentPage(1); }}>
                  {[10, 25, 50].map((n) => <option key={n} value={n}>Show {n} per row</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative bg-[#e9e6ff] text-indigo-500 rounded">
                  <select
                    className="block bg-[#e9e6ff] appearance-none rounded text-indigo-500 pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer border border-indigo-200"
                    defaultValue=""
                    onChange={(e) => { const val = e.target.value; if (val) handleExport(val); e.target.value = ''; }}
                  >
                    <option value="" disabled>Export</option>
                    <option value="PDF">PDF</option>
                    <option value="CSV">CSV</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-indigo-500"><ChevronDown className="h-4 w-4" /></div>
                </div>
                <div className="relative">
                  <input type="text" placeholder="Search" value={search} onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }} className="pl-8 pr-3 py-1.5 border border-gray-300 rounded text-sm" />
                  <svg className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-left border-t border-gray-200">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-4 py-2">Full name</th>
                    <th className="px-4 py-2">Phone number</th>
                    <th className="px-4 py-2">Role</th>
                    <th className="px-4 py-2">Date created</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {staffLoading ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>
                  ) : staffError ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-red-400">{staffError}</td></tr>
                  ) : pagedStaff.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">No staff found.</td></tr>
                  ) : (
                    pagedStaff.map((s) => (
                      <tr key={s.id}>
                        <td className="px-4 py-2">{s.name}</td>
                        <td className="px-4 py-2">{s.phone}</td>
                        <td className="px-4 py-2">{s.role}</td>
                        <td className="px-4 py-2">{s.date}</td>
                        <td className="px-4 py-2"><span className="text-green-600 font-medium">{s.status}</span></td>
                        <td className="px-4 py-2 text-indigo-600 hover:text-indigo-800 cursor-pointer">
                          <button type="button" onClick={() => handleEditStaff(s)}><Pencil className="h-5 w-5" /></button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col sm:flex-row justify-between items-center p-4 text-sm">
              <button onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))} disabled={currentPage === 1} className="text-gray-600 hover:text-indigo-600 disabled:text-gray-300">← Previous</button>
              <div className="flex gap-1 mt-2 sm:mt-0">
                {Array.from({ length: totalPages }, (_, i) => (
                  <button key={i + 1} onClick={() => setCurrentPage(i + 1)} className={`px-3 py-1 rounded ${currentPage === i + 1 ? 'bg-indigo-600 text-white' : 'hover:bg-gray-200 text-gray-700'}`}>{i + 1}</button>
                ))}
              </div>
              <button onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))} disabled={currentPage === totalPages} className="text-gray-600 hover:text-indigo-600 disabled:text-gray-300">Next →</button>
            </div>
          </>
        )}

        {/* ── Roles tab ── */}
        {tab === 'roles' && (
          <div className="overflow-x-auto">
            <div className="p-4">
              <button type="button" onClick={() => openSidebar('role')} className="px-3 py-2 bg-indigo-600 text-white rounded text-sm font-medium">Create role</button>
            </div>
            {rolesLoading ? (
              <p className="text-center py-8 text-gray-400">Loading…</p>
            ) : rolesError ? (
              <p className="text-center py-8 text-red-400">{rolesError}</p>
            ) : (
              <table className="min-w-full divide-y divide-gray-200 table-fixed">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => requestSort('roleId')}>
                      <div className="flex items-center">ID{getSortIcon('roleId')}</div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => requestSort('roleName')}>
                      <div className="flex items-center">Role{getSortIcon('roleName')}</div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Can&apos;t view</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Can view only</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Can edit</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => requestSort('lastUpdated')}>
                      <div className="flex items-center">Last updated{getSortIcon('lastUpdated')}</div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => requestSort('dateCreated')}>
                      <div className="flex items-center">Date created{getSortIcon('dateCreated')}</div>
                    </th>
                    <th className="relative px-6 py-3 w-16"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedRoles.length === 0 ? (
                    <tr><td colSpan={8} className="px-6 py-6 text-center text-gray-400">No roles found. Create one above.</td></tr>
                  ) : sortedRoles.map((role) => (
                    <tr key={role.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{role.roleId}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 font-medium">{role.roleName}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{role.cantView}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{role.canViewOnly}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{role.canEdit}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{role.lastUpdated}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{role.dateCreated}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium relative">
                        <div className="flex justify-end space-x-2">
                          <button onClick={() => handleEditRole(role)} className="cursor-pointer">
                            <Pencil className="h-5 w-5 text-indigo-600 hover:text-indigo-800" />
                          </button>
                          <button onClick={() => roleDropdownOptions(role.id)} className="cursor-pointer text-gray-500 hover:text-gray-700">
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0-12a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>
                          </button>
                        </div>
                        {roleDropdownId === role.id && (
                          <div ref={dropdownRef} className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-10">
                            <button onClick={() => handleRoleDeletion(role.id)} className="flex items-center w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" role="menuitem">
                              <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {/* Edit role sidebar */}
            {isEditRoleOpen && selectedRole && (
              <EditRoleSidebar
                isOpen={isEditRoleOpen}
                onClose={() => setIsEditRoleOpen(false)}
                initialRole={selectedRole}
                onSave={handleSaveRole}
              />
            )}
          </div>
        )}
      </div>

      <CreateSidebar isOpen={isSidebarOpen} onClose={closeSidebar} type={sidebarType} />
      <EditStaffModal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} staffData={selectedStaff} onSave={handleSaveStaff} />
    </div>
  );
}
