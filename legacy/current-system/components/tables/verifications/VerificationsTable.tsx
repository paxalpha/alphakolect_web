"use client"
import React, { useState, useMemo } from 'react'
import Image from 'next/image'
import { ChevronDown, ChevronRight, Filter, Download, Search, Check, X as CloseIcon } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Pagination from '../../admin/pagination';
import adminAPI from '@/app/admin/utilis/adminApi';

interface VerificationsTableProps {
  onViewDetails?: (request: any) => void;
  refreshTrigger?: number;
}

const VerificationsTable = ({ onViewDetails, refreshTrigger }: VerificationsTableProps) => {
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [entriesPerPage, setEntriesPerPage] = useState<number>(10)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  // Fetch verifications from API
  const { data: verificationsData, isLoading } = useQuery({
    queryKey: ['verifications', refreshTrigger],
    queryFn: () => adminAPI.getVerifications(),
  });

  const allRequests = verificationsData?.requests || [];

  // Group requests by Merchant (and Tier path)
  const groupedRequests = useMemo(() => {
    const groups: Record<string, any[]> = {};
    allRequests.forEach((req: any) => {
      const key = `${req.merchantId}-${req.targetLevel}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(req);
    });

    return Object.entries(groups).map(([key, requests]) => {
      // Sort requests by date (latest first for history, but main row is the latest)
      const sorted = [...requests].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const main = sorted[0]; // Latest request
      return {
        id: key,
        merchantId: main.merchantId,
        merchant: main.Merchant,
        tier: main.targetLevel,
        attempts: sorted.length,
        latestStatus: main.status,
        reason: main.rejectionReason || 'Nil',
        latestDate: main.createdAt,
        history: sorted,
        latestRequest: main // Keep reference to the actual request object for actions
      };
    });
  }, [allRequests]);

  // Filter based on search
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedRequests;
    const query = searchQuery.toLowerCase();
    return groupedRequests.filter(group => 
      group.merchant?.businessName?.toLowerCase().includes(query) ||
      group.merchant?.email?.toLowerCase().includes(query) ||
      group.tier?.toString().includes(query)
    );
  }, [groupedRequests, searchQuery]);

  // Paginate
  const paginatedGroups = useMemo(() => {
    const start = (currentPage - 1) * entriesPerPage;
    return filteredGroups.slice(start, start + entriesPerPage);
  }, [filteredGroups, currentPage, entriesPerPage]);

  const totalPages = Math.ceil(filteredGroups.length / entriesPerPage);

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number, status: 'approved' | 'rejected' }) => 
      adminAPI.updateVerificationStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['verifications'] });
      alert('Verification status updated successfully');
    },
    onError: (error: any) => {
      alert(error.message || 'Failed to update status');
    }
  });

  const getStatusStyle = (status: string) => {
    switch(status.toLowerCase()) {
      case 'approved': return 'text-green-600 bg-green-50 px-2 py-0.5 rounded text-xs font-semibold';
      case 'rejected': 
      case 'declined': return 'text-red-600 bg-red-50 px-2 py-0.5 rounded text-xs font-semibold';
      default: return 'text-amber-600 bg-amber-50 px-2 py-0.5 rounded text-xs font-semibold';
    }
  };

  return (
    <div className='bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden font-inter'>
      {/* Table Controls */}
      <div className='p-6 flex flex-wrap items-center justify-between gap-4'>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            <Filter size={16} /> Filter
          </button>
          
          <select
            value={entriesPerPage}
            onChange={(e) => setEntriesPerPage(Number(e.target.value))}
            className="h-[40px] px-4 outline-none rounded-lg border border-gray-200 text-sm font-medium bg-white text-gray-700"
          >
            <option value={10}>Show 10 per row</option>
            <option value={20}>Show 20 per row</option>
            <option value={50}>Show 50 per row</option>
          </select>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <button className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-bold hover:bg-indigo-100 transition-colors">
            Export <ChevronDown size={16} />
          </button>

          <div className="relative flex-1 md:w-[300px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-[40px] pl-10 pr-4 outline-none border border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Table Head */}
      <div className='overflow-x-auto'>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-y border-gray-50 bg-[#F9FAFB] text-left">
              <th className="w-10 px-4"></th>
              <th className="px-4 py-3 text-[12px] font-semibold text-[#667085] uppercase tracking-wider">Date</th>
              <th className="px-4 py-3 text-[12px] font-semibold text-[#667085] uppercase tracking-wider">Merchant</th>
              <th className="px-4 py-3 text-[12px] font-semibold text-[#667085] uppercase tracking-wider">Tier</th>
              <th className="px-4 py-3 text-[12px] font-semibold text-[#667085] uppercase tracking-wider text-center">Attempts</th>
              <th className="px-4 py-3 text-[12px] font-semibold text-[#667085] uppercase tracking-wider">Latest status</th>
              <th className="px-4 py-3 text-[12px] font-semibold text-[#667085] uppercase tracking-wider">Reason</th>
              <th className="px-4 py-3 text-[12px] font-semibold text-[#667085] uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>

          <tbody className="">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-6 py-20 text-center text-gray-400 animate-pulse">Loading verification records...</td>
              </tr>
            ) : paginatedGroups.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-20 text-center text-gray-400 italic">No verification records found</td>
              </tr>
            ) : (
              paginatedGroups.map((group) => (
                <React.Fragment key={group.id}>
                  {/* Main Row */}
                  <tr className={`hover:bg-gray-50 transition-colors group border-b border-gray-50 ${expandedRows.has(group.id) ? 'bg-indigo-50/20' : ''}`}>
                    <td className="px-4 py-4 text-center">
                      <button 
                        onClick={() => toggleExpand(group.id)}
                        className="p-1 hover:bg-white rounded transition-colors"
                      >
                        {expandedRows.has(group.id) ? <ChevronDown size={18} className="text-gray-600" /> : <ChevronRight size={18} className="text-gray-400" />}
                      </button>
                    </td>
                    <td className="px-4 py-4 text-sm text-[#344054]">
                      {new Date(group.latestDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-sm font-semibold text-[#101828]">{group.merchant?.businessName}</p>
                    </td>
                    <td className="px-4 py-4 text-sm text-[#344054]">Tier {group.tier}</td>
                    <td className="px-4 py-4 text-center text-sm font-medium text-[#344054]">{group.attempts}</td>
                    <td className="px-4 py-4">
                      <span className={getStatusStyle(group.latestStatus)}>
                        {group.latestStatus === 'rejected' ? 'Declined' : group.latestStatus.charAt(0).toUpperCase() + group.latestStatus.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-[#667085]">
                      {group.reason}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {group.latestStatus === 'pending' && (
                          <>
                            <button 
                              onClick={() => updateStatusMutation.mutate({ id: group.latestRequest.id, status: 'approved' })}
                              className="px-3 py-1.5 border border-green-200 text-green-600 rounded-lg text-xs font-bold hover:bg-green-50 transition-all active:scale-95"
                            >
                              Approve
                            </button>
                            <button 
                              onClick={() => updateStatusMutation.mutate({ id: group.latestRequest.id, status: 'rejected' })}
                              className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-xs font-bold hover:bg-red-50 transition-all active:scale-95"
                            >
                              Decline
                            </button>
                          </>
                        )}
                        <button 
                          onClick={() => onViewDetails?.(group.latestRequest)}
                          className="px-3 py-1.5 border border-[#4E37FB] text-[#4E37FB] rounded-lg text-xs font-bold hover:bg-indigo-50 transition-all active:scale-95"
                        >
                          View
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded Row (History) */}
                  {expandedRows.has(group.id) && (
                    <tr className="bg-[#FDFDFD]">
                      <td colSpan={2}></td>
                      <td colSpan={6} className="px-4 py-3">
                        <div className="border border-gray-100 rounded-lg overflow-hidden bg-white shadow-sm">
                          <table className="w-full text-left">
                            <thead className="bg-[#F9FAFB] border-b border-gray-100">
                              <tr>
                                <th className="px-4 py-2 text-[11px] font-semibold text-[#667085] uppercase tracking-wider">Date</th>
                                <th className="px-4 py-2 text-[11px] font-semibold text-[#667085] uppercase tracking-wider">Tier</th>
                                <th className="px-4 py-2 text-[11px] font-semibold text-[#667085] uppercase tracking-wider">Status</th>
                                <th className="px-4 py-2 text-[11px] font-semibold text-[#667085] uppercase tracking-wider">Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.history.map((hist: any) => (
                                <tr key={hist.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                                  <td className="px-4 py-2.5 text-xs text-gray-600">{new Date(hist.createdAt).toLocaleDateString()}</td>
                                  <td className="px-4 py-2.5 text-xs text-gray-600">Tier {hist.targetLevel}</td>
                                  <td className="px-4 py-2.5">
                                    <span className={`text-[10px] font-bold p-1 rounded ${getStatusStyle(hist.status)}`}>
                                      {hist.status === 'rejected' ? 'Declined' : hist.status.charAt(0).toUpperCase() + hist.status.slice(1)}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-xs text-gray-500 italic">{hist.rejectionReason || 'Nil'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className='p-6 border-t border-gray-50'>
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalItems={filteredGroups.length}
          itemsPerPage={entriesPerPage}
        />
      </div>
    </div>
  )
}

export default VerificationsTable;

