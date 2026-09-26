"use client"
import React, { useState } from 'react'
import { FaPlus } from 'react-icons/fa'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import StaffTable from '../../../../../../components/tables/Staff/Stafftable'
import RolesTable from '../../../../../../components/tables/Staff/Rolestable'
import Addpackage from '../../../../../../components/tables/Staff/modals/Add&EditstaffModal'
import Addroles from '../../../../../../components/tables/Staff/modals/AddEditroleModal'
import DeleteModal from '../../../../../../components/tables/Staff/modals/DeleteModal'
import adminAPI from '../../../utilis/adminApi'

// Shared Types
interface StaffMember {
  id: string | number;
  fullName?: string;
  name?: string;
  email: string;
  phoneNumber: string;
  role?: string;
  AdminRole?: { id: number; name: string };
  status: 'active' | 'inactive';
  created?: string;
  createdAt?: string;
}

interface RoleMember {
  id: string | number;
  roleName?: string;
  name?: string;
  cantView?: string;
  canViewOnly?: string;
  canEdit?: string;
  permissions?: string[];
  lastUpdated?: string;
  updatedAt?: string;
  created?: string;
  createdAt?: string;
}

type StaffFormData = {
  full_name: string
  Email: string
  phone_number: string
  role: string
}

type RoleFormData = {
  role_name: string
  dashboard: string
  merchants: string
  transactions: string
  billings: string
  audits: string
  support: string
}

const Page = () => {
  // Tab state
  const [activeTab, setActiveTab] = useState<'staffs' | 'roles'>('staffs')
  const queryClient = useQueryClient();

  // Fetch staff from API
  const { data: staffApiData, isLoading: staffLoading } = useQuery({
    queryKey: ['allAdminStaff'],
    queryFn: adminAPI.getAllAdminStaff,
  });

  // Fetch roles from API
  const { data: rolesApiData, isLoading: rolesLoading } = useQuery({
    queryKey: ['allRoles'],
    queryFn: adminAPI.getAllRoles,
  });

  // Modal states - Staff
  const [staffModalOpen, setStaffModalOpen] = useState(false)
  const [staffEditMode, setStaffEditMode] = useState(false)
  const [staffToEdit, setStaffToEdit] = useState<StaffMember | null>(null)

  // Modal states - Roles
  const [roleModalOpen, setRoleModalOpen] = useState(false)
  const [roleEditMode, setRoleEditMode] = useState(false)
  const [roleToEdit, setRoleToEdit] = useState<RoleMember | null>(null)

  // Delete Modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [roleToDeleteId, setRoleToDeleteId] = useState<string | number | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Data from API or fallback to empty arrays
  const staffData = staffApiData?.data || []
  const rolesData = rolesApiData?.data || []

  // Staff Handlers
  const handleAddStaff = async (data: StaffFormData) => {
    try {
      // Find the role ID from the role name
      const selectedRole = rolesData.find((r: any) => r.name === data.role)
      
      if (!selectedRole) {
        alert('Please select a valid role')
        return
      }
      
      // Transform data to match backend expectations
      const staffData = {
        name: data.full_name,
        email: data.Email,
        phoneNumber: data.phone_number,
        password: 'TempPass@123', // Default password - should be changed on first login
        roleId: selectedRole.id,
      }
      
      await adminAPI.createAdminStaff(staffData)
      // After adding staff, invalidate the query to refetch
      queryClient.invalidateQueries({ queryKey: ['allAdminStaff'] })
    } catch (error) {
      console.error('Error creating staff:', error)
      alert('Failed to create staff. Please try again.')
    }
  }

  const handleUpdateStaff = async (data: StaffFormData, id: string) => {
    try {
      // Find role ID from role name
      const selectedRole = rolesData?.find((r: any) => r.name === data.role || r.roleName === data.role)
      
      const staffUpdateData = {
        name: data.full_name,
        email: data.Email,
        phoneNumber: data.phone_number,
        roleId: selectedRole ? selectedRole.id : undefined,
      }

      await adminAPI.updateAdminStaff(id, staffUpdateData)
      // After updating staff, invalidate the query to refetch
      queryClient.invalidateQueries({ queryKey: ['allAdminStaff'] })
      closeStaffModal()
    } catch (error) {
      console.error('Error updating staff:', error)
      alert('Failed to update staff. Please try again.')
    }
  }

  const openStaffCreateModal = () => {
    setStaffToEdit(null)
    setStaffEditMode(false)
    setStaffModalOpen(true)
  }

  const openStaffEditModal = (staff: StaffMember) => {
    setStaffToEdit(staff)
    setStaffEditMode(true)
    setStaffModalOpen(true)
  }

  const closeStaffModal = () => {
    setStaffModalOpen(false)
    setStaffEditMode(false)
    setStaffToEdit(null)
  }

  // Roles Handlers
  const handleAddRole = async (data: RoleFormData) => {
    try {
      // Transform data to match backend expectations
      const permissions: string[] = []
      
      // Map form permissions to backend permission format
      const permissionMap: Record<string, string[]> = {
        dashboard: ['view_dashboard', 'view_analytics'],
        merchants: ['view_merchants', 'create_merchant', 'edit_merchant', 'delete_merchant', 'approve_merchant', 'suspend_merchant'],
        transactions: ['view_transactions', 'approve_transaction', 'reject_transaction', 'refund_transaction'],
        billings: ['view_plans', 'create_plan', 'edit_plan', 'delete_plan'],
        audits: ['view_activities', 'view_logs'],
        support: ['manage_notifications'],
      }
      
      // Add permissions based on access level
      Object.entries(data).forEach(([key, value]) => {
        if (key !== 'role_name' && permissionMap[key]) {
          if (value === 'full') {
            permissions.push(...permissionMap[key])
          } else if (value === 'view') {
            // Only add view permissions
            const viewPerms = permissionMap[key].filter(p => p.startsWith('view_'))
            permissions.push(...viewPerms)
          }
          // 'none' means no permissions added
        }
      })
      
      const roleData = {
        name: data.role_name,
        permissions: permissions.length > 0 ? permissions : [],
      }
      
      await adminAPI.createRole(roleData)
      // After adding role, invalidate the query to refetch
      queryClient.invalidateQueries({ queryKey: ['allRoles'] })
    } catch (error) {
      console.error('Error creating role:', error)
      alert('Failed to create role. Please try again.')
    }
  }

  const handleUpdateRole = async (data: RoleFormData, id: string) => {
    try {
      // Transform data to match backend expectations
      const permissions: string[] = []
      
      // Map form permissions to backend permission format
      const permissionMap: Record<string, string[]> = {
        dashboard: ['view_dashboard', 'view_analytics'],
        merchants: ['view_merchants', 'create_merchant', 'edit_merchant', 'delete_merchant', 'approve_merchant', 'suspend_merchant'],
        transactions: ['view_transactions', 'approve_transaction', 'reject_transaction', 'refund_transaction'],
        billings: ['view_plans', 'create_plan', 'edit_plan', 'delete_plan'],
        audits: ['view_activities', 'view_logs'],
        support: ['manage_notifications'],
      }
      
      // Add permissions based on access level
      Object.entries(data).forEach(([key, value]) => {
        if (key !== 'role_name' && permissionMap[key]) {
          if (value === 'full') {
            permissions.push(...permissionMap[key])
          } else if (value === 'view') {
            // Only add view permissions
            const viewPerms = permissionMap[key].filter(p => p.startsWith('view_'))
            permissions.push(...viewPerms)
          }
          // 'none' means no permissions added
        }
      })
      
      const roleData = {
        name: data.role_name,
        permissions: permissions.length > 0 ? permissions : [],
      }

      await adminAPI.updateRole(id, roleData)
      // After updating role, invalidate the query to refetch
      queryClient.invalidateQueries({ queryKey: ['allRoles'] })
      closeRoleModal()
    } catch (error) {
      console.error('Error updating role:', error)
      alert('Failed to update role. Please try again.')
    }
  }

  const handleDeleteRole = (id: string | number) => {
    setRoleToDeleteId(id)
    setDeleteError(null)
    setDeleteModalOpen(true)
  }

  const confirmDeleteRole = async () => {
    console.log('confirmDeleteRole called. roleToDeleteId:', roleToDeleteId)
    if (!roleToDeleteId) {
        console.error('roleToDeleteId is missing!')
        return
    }
    
    setIsDeleting(true)
    setDeleteError(null)
    try {
      console.log('Sending delete request...')
      const res = await adminAPI.deleteRole(roleToDeleteId)
      console.log('Delete response:', res)
      queryClient.invalidateQueries({ queryKey: ['allRoles'] })
      setDeleteModalOpen(false)
      setRoleToDeleteId(null)
    } catch (error: any) {
      console.error('Error deleting role:', error)
      setDeleteError(error.message || 'Failed to delete role')
    } finally {
      setIsDeleting(false)
    }
  }

  const openRoleCreateModal = () => {
    setRoleToEdit(null)
    setRoleEditMode(false)
    setRoleModalOpen(true)
  }

  const openRoleEditModal = (role: RoleMember) => {
    setRoleToEdit(role)
    setRoleEditMode(true)
    setRoleModalOpen(true)
  }

  const closeRoleModal = () => {
    setRoleModalOpen(false)
    setRoleEditMode(false)
    setRoleToEdit(null)
  }

  return (
    <div>
      {/* Header */}
      <div className='flex flex-wrap justify-between gap-4 md:gap-0 max-md:flex-col max-md:gap-[10px]'>
        <div className='flex flex-col gap-[3px] min-w-0 w-full md:w-auto'>
          <h1 className='font-inter font-semibold leading-[32px] text-[24px]'>Staff management</h1>
          <p className='leading-[24px] font-inter font-normal text-[#717680] text-[14px]'>
            Manage and monitor all platform staff.
          </p>
        </div>

        <div className='flex items-end mt-4 md:mt-0 w-full md:w-auto'>
          {activeTab === 'staffs' ? (
            <button
              onClick={openStaffCreateModal}
              className='bg-[#4E37FB] flex h-[40px] cursor-pointer w-full md:w-[167px] rounded-[4px] items-center gap-[9px] justify-center'
            >
              <FaPlus className='text-white font-normal w-[12px]' />
              <p className='text-[14px] font-inter text-white font-medium'>Create Staff</p>
            </button>
          ) : (
            <button
              onClick={openRoleCreateModal}
              className='bg-[#4E37FB] flex h-[40px] cursor-pointer w-full md:w-[167px] rounded-[4px] items-center gap-[9px] justify-center'
            >
              <FaPlus className='text-white font-normal w-[12px]' />
              <p className='text-[14px] font-inter text-white font-medium'>Create Role</p>
            </button>
          )}
        </div>
      </div>

      {/* Tabs & Content */}
      <div className='bg-white shadow-lg mt-6 mb-2'>
        <div className="flex items-center flex-nowrap pt-5 border-b border-gray-300 overflow-x-auto whitespace-nowrap hide-scrollbar">
          {[
            { id: 'staffs', label: 'Staff Members' },
            { id: 'roles', label: 'Roles' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'staffs' | 'roles')}
              className={`flex-shrink-0 relative font-inter px-6 pb-2 text-sm sm:text-base transition-all ${
                activeTab === tab.id
                  ? 'font-semibold text-[#1E1E1E] text-base'
                  : 'font-normal text-[#9E9E9E] text-base'
              }`}
            >
              {tab.label}
              <span
                className={`absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-10/12 transition-all ${
                  activeTab === tab.id ? 'bg-[#4E37FB] h-[3px]' : ''
                }`}
              />
            </button>
          ))}
        </div>

        <div className="overflow-x-auto mt-2">
          {activeTab === 'staffs' && (
            <StaffTable
              staffData={staffData}
              onOpenEditModal={openStaffEditModal}
            />
          )}
          {activeTab === 'roles' && (
            <RolesTable
              rolesData={rolesData}
              onOpenEditModal={openRoleEditModal}
              onDeleteRole={handleDeleteRole}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      <Addpackage
        packag={staffModalOpen}
        onClose={closeStaffModal}
        mode={staffEditMode ? 'edit' : 'add'}
        merchant={staffToEdit}
        onAddStaff={handleAddStaff}
        onUpdateStaff={handleUpdateStaff}
        rolesData={rolesData}
      />

      <Addroles
        packag={roleModalOpen}
        onClose={closeRoleModal}
        mode={roleEditMode ? 'edit' : 'add'}
        merchant={roleToEdit}
        onAddRole={handleAddRole}
        onUpdateRole={handleUpdateRole}
      />

      <DeleteModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={confirmDeleteRole}
        title="Delete Role"
        message="Are you sure you want to delete this role? This action cannot be undone."
        isLoading={isDeleting}
        error={deleteError}
      />
    </div>
  )
}

export default Page






