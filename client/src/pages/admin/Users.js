import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Users,
  User,
  Shield,
  Download,
  FileText
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import LoadingSpinner from '../../components/LoadingSpinner';
import UserProfileModal from '../../components/UserProfileModal';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';

const UsersList = () => {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [userFinancialData, setUserFinancialData] = useState({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createUserForm, setCreateUserForm] = useState({
    name: '',
    phone: '',
    email: ''
  });
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [debtLogs, setDebtLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsPagination, setLogsPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalRecords: 0,
    recordsPerPage: 50
  });
  const [logsSearch, setLogsSearch] = useState({
    clientName: '',
    date: ''
  });
  // No date range for users report

  useEffect(() => {
    fetchUsers();

    // Check if there was a recent order creation
    const lastOrderCreated = localStorage.getItem('lastOrderCreated');
    if (lastOrderCreated) {
      try {
        const orderData = JSON.parse(lastOrderCreated);
        const timeDiff = Date.now() - orderData.timestamp;
        
        // If the order was created within the last 30 seconds, refresh financial data
        if (timeDiff < 30000) {
          setTimeout(() => {
            if (users.length > 0) {
              const clientUsers = users.filter(user => user.role === 'client');
              if (clientUsers.length > 0) {
                fetchUserFinancialData(clientUsers);
              }
            }
          }, 1000); // Small delay to ensure users are loaded
        }
        
        // Clear the localStorage
        localStorage.removeItem('lastOrderCreated');
      } catch (error) {
        console.error('Error parsing lastOrderCreated:', error);
        localStorage.removeItem('lastOrderCreated');
      }
    }
  }, [currentPage, searchTerm]);

  // Handle ESC key for modals
  useEffect(() => {
    const handleEscKey = (event) => {
      if (event.key === 'Escape') {
        if (showCreateModal) {
          setShowCreateModal(false);
        }
        if (isProfileModalOpen) {
          handleCloseProfileModal();
        }
        if (showLogsModal) {
          closeLogsModal();
        }
      }
    };

    document.addEventListener('keydown', handleEscKey);
    return () => {
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [showCreateModal, isProfileModalOpen, showLogsModal]);

  const closeLogsModal = () => {
    setShowLogsModal(false);
    setDebtLogs([]);
    setLogsPagination({
      currentPage: 1,
      totalPages: 1,
      totalRecords: 0,
      recordsPerPage: 50
    });
    setLogsSearch({
      clientName: '',
      date: ''
    });
  };

  // Listen for order creation events to refresh financial data
  useEffect(() => {
    const handleOrderCreated = () => {
      // Refresh financial data for all clients when an order is created
      if (users.length > 0) {
        const clientUsers = users.filter(user => user.role === 'client');
        if (clientUsers.length > 0) {
          fetchUserFinancialData(clientUsers);
        }
      }
    };

    window.addEventListener('orderCreated', handleOrderCreated);
    return () => {
      window.removeEventListener('orderCreated', handleOrderCreated);
    };
  }, [users]);

  const fetchUsers = async () => {
    try {
      const params = new URLSearchParams({
        page: currentPage,
        limit: 10,
        search: searchTerm
      });



      const response = await axios.get(`/api/users?${params}`);
      setUsers(response.data.users);
      setTotalPages(response.data.pagination.totalPages);
      
      // Fetch financial data for client users
      const clientUsers = response.data.users.filter(user => user.role === 'client');
      if (clientUsers.length > 0) {
        await fetchUserFinancialData(clientUsers);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const fetchUserFinancialData = async (clientUsers) => {
    try {
      const financialData = {};
      
      await Promise.all(
        clientUsers.map(async (user) => {
          try {
            const response = await axios.get(`/api/users/${user.id}/profile`);
            const profile = response.data;
            
            // Use the financial summary from the backend (includes manual adjustments)
            const eurRevenue = profile.financialSummary?.eurRevenue ?? 0;
            const mkdRevenue = profile.financialSummary?.mkdRevenue ?? 0;
            const eurDebt = profile.financialSummary?.eurDebt ?? 0;
            const mkdDebt = profile.financialSummary?.mkdDebt ?? 0;

            financialData[user.id] = {
              revenueEUR: eurRevenue,
              revenueMKD: mkdRevenue,
              revenue: eurRevenue + mkdRevenue,
              debtEUR: eurDebt,
              debtMKD: mkdDebt,
              debt: eurDebt + mkdDebt
            };
          } catch (error) {
            console.error(`Error fetching financial data for user ${user.id}:`, error);
            financialData[user.id] = { revenue: 0, revenueEUR: 0, revenueMKD: 0, debt: 0, debtEUR: 0, debtMKD: 0 };
          }
        })
      );
      
      setUserFinancialData(financialData);
    } catch (error) {
      console.error('Error fetching user financial data:', error);
    }
  };

  const getRoleColor = (role) => {
    return role === 'admin' ? 'purple' : 'blue';
  };

  const handleViewProfile = (userId) => {
    setSelectedUserId(userId);
    setIsProfileModalOpen(true);
  };

  const handleCloseProfileModal = () => {
    setIsProfileModalOpen(false);
    setSelectedUserId(null);
    // Refresh financial data when modal is closed to reflect any changes
    if (users.length > 0) {
      const clientUsers = users.filter(user => user.role === 'client');
      if (clientUsers.length > 0) {
        fetchUserFinancialData(clientUsers);
      }
    }
  };

  const createUser = async () => {
    try {
      if (!createUserForm.name.trim()) {
        toast.error('Name is required');
        return;
      }

      await axios.post('/api/users', {
        name: createUserForm.name.trim(),
        phone: createUserForm.phone.trim() || undefined,
        email: createUserForm.email.trim() || undefined,
        role: 'client'
      });

      toast.success('Client user created successfully');
      setShowCreateModal(false);
      setCreateUserForm({ name: '', phone: '', email: '' });
      fetchUsers();
    } catch (error) {
      console.error('Error creating user:', error);
      toast.error(error.response?.data?.message || 'Failed to create user');
    }
  };

  const deleteUser = async (userId, userName) => {
    if (!window.confirm(`Are you sure you want to delete user '${userName}'? This action cannot be undone.`)) {
      return;
    }

    try {
      await axios.delete(`/api/users/${userId}`);
      toast.success(`User '${userName}' deleted successfully`);
      fetchUsers();
    } catch (error) {
      console.error('Error deleting user:', error);
      if (error.response?.status === 400) {
        toast.error(error.response.data.message);
      } else {
        toast.error('Failed to delete user');
      }
    }
  };

  const fetchDebtLogsWithSearch = async (page = 1, searchParams = null) => {
    if (!isAdmin) {
      toast.error('Admin privileges required to view debt logs');
      return;
    }

    setLoadingLogs(true);
    try {
      // Use provided search params or current state
      const currentSearch = searchParams || logsSearch;

      // Build query parameters
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '50'
      });

      if (currentSearch.clientName.trim()) {
        params.append('clientName', currentSearch.clientName.trim());
      }

      if (currentSearch.date) {
        params.append('date', currentSearch.date);
      }

      const response = await axios.get(`/api/users/debt-logs?${params.toString()}`);
      setDebtLogs(response.data.logs || []);
      if (response.data.pagination) {
        setLogsPagination(response.data.pagination);
      }
    } catch (error) {
      console.error('Error fetching debt logs:', error);
      if (error.response?.status === 403) {
        toast.error('Access denied: Admin privileges required');
      } else {
        toast.error('Failed to fetch debt logs');
      }
    } finally {
      setLoadingLogs(false);
    }
  };

  const fetchDebtLogs = async (page = 1) => {
    return fetchDebtLogsWithSearch(page);
  };

  useEffect(() => {
    if (showLogsModal) {
      fetchDebtLogs();
    }
  }, [showLogsModal]);

  const generateUsersReport = async () => {
    try {
      // Fetch up to 1000 users matching current filters
      const params = new URLSearchParams({ limit: 1000, page: 1 });
      if (searchTerm) params.append('search', searchTerm);
      // Force clients only for report regardless of UI role filter
      params.append('role', 'client');
      const res = await axios.get(`/api/users?${params.toString()}`);
      let allUsers = Array.isArray(res.data?.users) ? res.data.users : [];
      // Ensure only clients are included
      allUsers = allUsers.filter(u => u.role === 'client');

      // No date filtering for users report

      if (allUsers.length === 0) {
        toast.error('No users found for the selected range');
        return;
      }

      // Fetch financial summaries (debt and orders) for clients included in report
      const financialByUserId = {};
      await Promise.all(
        allUsers.map(async (u) => {
          try {
            const prof = await axios.get(`/api/users/${u.id}/profile`);
            const fs = prof.data?.financialSummary || {};
            financialByUserId[u.id] = {
              eurDebt: fs.eurDebt ?? 0,
              mkdDebt: fs.mkdDebt ?? 0,
              orders: (fs.pendingOrders ?? 0) + (fs.completedOrders ?? 0)
            };
          } catch {
            financialByUserId[u.id] = { eurDebt: 0, mkdDebt: 0, orders: 0 };
          }
        })
      );

      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 10;
      const lineHeight = 4.2;
      let y = 18;

      // Title
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('Users Report', margin, y);
      y += 8;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Generated on: ${new Date().toLocaleDateString('en-GB')}`, margin, y);
      y += 6;
      doc.text(`Items: ${allUsers.length}`, margin, y);
      y += 6;

      const colX = {
        name: margin,
        joined: margin + 90,
        orders: margin + 120,
        debtEUR: margin + 145,
        debtMKD: margin + 175
      };

      const drawHeader = () => {
        doc.setFont('helvetica', 'bold');
        doc.text('Name', colX.name, y);
        doc.text('Joined', colX.joined, y);
        doc.text('Orders', colX.orders, y);
        doc.text('Debt EUR', colX.debtEUR, y);
        doc.text('Debt MKD', colX.debtMKD, y);
        y += lineHeight + 1;
        doc.setDrawColor(150);
        doc.line(margin, y, pageWidth - margin, y);
        y += 2;
        doc.setFont('helvetica', 'normal');
      };

      drawHeader();
      y += 3;
      const pageHeight = doc.internal.pageSize.getHeight();
      let totalDebtEUR = 0, totalDebtMKD = 0;

      for (const u of allUsers) {
        if (y > pageHeight - 20) {
          doc.addPage();
          y = 15;
          drawHeader();
          y += 3;
        }
        const joined = u.created_at ? new Date(u.created_at).toLocaleDateString('en-GB') : '-';
        const fs = financialByUserId[u.id] || { eurDebt: 0, mkdDebt: 0, orders: 0 };
        totalDebtEUR += fs.eurDebt;
        totalDebtMKD += fs.mkdDebt;

        doc.text(String(u.name).slice(0, 28), colX.name, y);
        doc.text(joined, colX.joined, y);
        doc.text(String(fs.orders), colX.orders, y);
        doc.text(String(Math.round(fs.eurDebt)).padStart(1), colX.debtEUR, y);
        doc.text(String(Math.round(fs.mkdDebt)).padStart(1), colX.debtMKD, y);

        // row separator
        doc.setDrawColor(220);
        doc.line(margin, y + 1.2, pageWidth - margin, y + 1.2);
        y += lineHeight + 1.5;
      }

      // Totals Section
      if (y > pageHeight - 40) {
        doc.addPage();
        y = 20;
      }
      y += 6;
      doc.setFont('helvetica', 'bold');
      doc.text('Totals (Debt Only)', margin, y);
      y += 6;
      doc.setFont('helvetica', 'normal');
      doc.text(`Total Debt EUR: ${Math.round(totalDebtEUR)} EUR`, margin, y);
      y += 5;
      doc.text(`Total Debt MKD: ${Math.round(totalDebtMKD)} MKD`, margin, y);

      const fileName = `users-report-${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
      toast.success('Users report generated');
    } catch (err) {
      console.error('Error generating users report:', err);
      toast.error('Failed to generate users report');
    }
  };

  if (loading) {
    return <LoadingSpinner size="lg" className="mt-8" />;
  }

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage user accounts and permissions
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          {/* Search Users */}
          <div className="relative flex-1 sm:flex-none sm:w-64">
            <input
              type="text"
              placeholder="Search by client name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input"
            />
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary w-full sm:w-auto"
        >
          <User className="h-4 w-4 mr-2" />
          Add Client
        </button>
        </div>
      </div>



       {/* Users List */}
       <div className="card w-full">
         <div className="card-header">
           <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
           <h3 className="text-lg font-medium text-gray-900">All Users</h3>
             <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
               <button
                 onClick={() => setShowLogsModal(true)}
                 disabled={!isAdmin}
                 className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                 title={!isAdmin ? "Admin privileges required" : "View debt reduction logs"}
               >
                 <FileText className="h-4 w-4" />
                 Logs
               </button>
               <button
                 onClick={generateUsersReport}
                 className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                 title="Generate full users report"
               >
                 <Download className="h-4 w-4" />
                 Generate Report
               </button>
             </div>
           </div>
         </div>
         <div className="card-body p-0">
           {users.length > 0 ? (
                         <div className="overflow-x-auto w-full">
              <table className="min-w-full divide-y divide-gray-200">
                 <thead className="bg-gray-50">
                   <tr>
                     <th className="px-2 sm:px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[200px]">
                       User
                     </th>
                     <th className="px-2 sm:px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px]">
                       Role
                     </th>
                     <th className="px-2 sm:px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[120px] hidden sm:table-cell">
                       Joined
                     </th>
                     <th className="px-2 sm:px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[140px]">
                       Revenue (EUR/MKD)
                     </th>
                     <th className="px-2 sm:px-4 lg:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[140px]">
                       Debt (EUR/MKD)
                     </th>
                   </tr>
                 </thead>
                 <tbody className="bg-white divide-y divide-gray-200">
                   {users.map((user) => (
                     <tr 
                       key={user.id} 
                       className={`hover:bg-gray-50 ${user.role === 'client' ? 'cursor-pointer' : ''}`}
                       onClick={user.role === 'client' ? () => handleViewProfile(user.id) : undefined}
                     >
                       <td className="px-2 sm:px-4 lg:px-6 py-4 min-w-[200px]">
                         <div className="flex items-center min-w-0">
                           <div className="flex-shrink-0 h-8 w-8 sm:h-10 sm:w-10">
                             <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-primary-100 flex items-center justify-center">
                               <User className="h-4 w-4 sm:h-5 sm:w-5 text-primary-600" />
                             </div>
                           </div>
                           <div className="ml-2 sm:ml-4 min-w-0 flex-1">
                             <div className="text-sm font-medium text-gray-900 truncate">
                               {user.name}
                             </div>
                             <div className="text-xs sm:text-sm text-gray-500 truncate">
                               {user.email || user.phone || 'No contact info'}
                             </div>
                           </div>
                         </div>
                       </td>
                       <td className="px-2 sm:px-4 lg:px-6 py-4 min-w-[100px]">
                         <span className={`badge-${getRoleColor(user.role)} text-xs`}>
                           {user.role}
                         </span>
                       </td>
                       <td className="px-2 sm:px-4 lg:px-6 py-4 text-sm text-gray-500 hidden sm:table-cell min-w-[120px]">
                         {new Date(user.created_at).toLocaleDateString()}
                       </td>
                       <td className="px-2 sm:px-4 lg:px-6 py-4 min-w-[140px]">
                         {user.role === 'client' ? (
                           <div className="flex items-center gap-2">
                             <span className="text-[11px] font-medium text-blue-700 bg-blue-50 px-2 py-1 rounded border border-blue-200 whitespace-nowrap">
                               € {(userFinancialData[user.id]?.revenueEUR ?? 0).toFixed(0)}
                             </span>
                             <span className="text-[11px] font-medium text-green-700 bg-green-50 px-2 py-1 rounded border border-green-200 whitespace-nowrap">
                               {(userFinancialData[user.id]?.revenueMKD ?? 0).toFixed(0)} MKD
                             </span>
                           </div>
                         ) : (
                           <span className="text-sm text-gray-400">-</span>
                         )}
                       </td>
                       <td className="px-2 sm:px-4 lg:px-6 py-4 min-w-[140px]">
                         {user.role === 'client' ? (
                           <div className="flex items-center gap-2">
                             <span className="text-[11px] font-medium text-red-700 bg-red-100 px-2 py-1 rounded border border-red-700 whitespace-nowrap">
                               € {(userFinancialData[user.id]?.debtEUR ?? 0).toFixed(0)}
                             </span>
                             <span className="text-[11px] font-medium text-red-700 bg-red-50 px-2 py-1 rounded border border-red-200 whitespace-nowrap">
                               {(userFinancialData[user.id]?.debtMKD ?? 0).toFixed(0)} MKD
                             </span>
                           </div>
                         ) : (
                           <span className="text-sm text-gray-400">-</span>
                         )}
                       </td>
                     </tr>
                   ))}
                 </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Users className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No users found</h3>
              <p className="mt-1 text-sm text-gray-500">
                Try adjusting your search criteria.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between space-y-3 sm:space-y-0">
          <div className="text-sm text-gray-700">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => setCurrentPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="btn-secondary disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="btn-secondary disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* User Statistics */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 w-full">
        <div className="card">
          <div className="card-body">
            <div className="flex items-center">
              <div className="flex-shrink-0 p-3 rounded-md bg-blue-100">
                <Users className="h-6 w-6 text-blue-600" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Total Users</dt>
                  <dd className="text-lg font-medium text-gray-900">{users.length}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center">
              <div className="flex-shrink-0 p-3 rounded-md bg-purple-100">
                <Shield className="h-6 w-6 text-purple-600" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Admins</dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {users.filter(user => user.role === 'admin').length}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <div className="flex items-center">
              <div className="flex-shrink-0 p-3 rounded-md bg-green-100">
                <User className="h-6 w-6 text-green-600" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Clients</dt>
                  <dd className="text-lg font-medium text-gray-900">
                    {users.filter(user => user.role === 'client').length}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* User Profile Modal */}
      <UserProfileModal
        isOpen={isProfileModalOpen}
        onClose={handleCloseProfileModal}
        userId={selectedUserId}
        onDeleteUser={deleteUser}
      />

      {/* Debt Logs Modal */}
      {showLogsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 !mt-0">
          <div className="bg-white rounded-lg shadow-xl max-w-8xl w-full max-h-[90vh] flex flex-col">
            {/* Header with Search */}
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 flex-1">
                  <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <FileText className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold text-gray-900">
                      Debt Reduction Logs
                    </h2>
                    <p className="text-sm text-gray-500">Manual debt adjustments history</p>
                  </div>
                </div>

                {/* Search Fields in Header */}
                <div className="flex items-center gap-3 mr-4">
                  <div className="w-48">
                    <input
                      type="text"
                      value={logsSearch.clientName}
                      onChange={(e) => setLogsSearch(prev => ({ ...prev, clientName: e.target.value }))}
                      placeholder="Search client..."
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div className="w-40">
                    <input
                      type="date"
                      value={logsSearch.date}
                      onChange={(e) => setLogsSearch(prev => ({ ...prev, date: e.target.value }))}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <button
                    onClick={() => fetchDebtLogsWithSearch(1, logsSearch)}
                    disabled={loadingLogs}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {loadingLogs ? '...' : 'Search'}
                  </button>
                  <button
                    onClick={() => {
                      const clearedSearch = { clientName: '', date: '' };
                      setLogsSearch(clearedSearch);
                      // Fetch with cleared search values directly
                      fetchDebtLogsWithSearch(1, clearedSearch);
                    }}
                    disabled={loadingLogs}
                    className="px-3 py-1 text-sm bg-gray-500 text-white rounded hover:bg-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-500 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    Clear
                  </button>
                </div>

                <button
                  onClick={closeLogsModal}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {loadingLogs ? (
                <div className="flex items-center justify-center py-12">
                  <LoadingSpinner size="lg" />
                </div>
              ) : debtLogs.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Date & Time
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Client
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Action
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Amount
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Debt Before
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Debt After
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          By User
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Notes
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {debtLogs.map((log, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <div className="text-sm text-gray-900">
                              {new Date(log.created_at).toLocaleDateString('en-GB')}
                            </div>
                            <div className="text-xs text-gray-500">
                              {new Date(log.created_at).toLocaleTimeString('en-GB', {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="flex-shrink-0 h-8 w-8">
                                <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center">
                                  <User className="h-4 w-4 text-gray-600" />
                                </div>
                              </div>
                              <div className="ml-3">
                                <div className="text-sm font-medium text-gray-900">
                                  {log.client_name || log.guest_name || 'Unknown'}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                              parseFloat(log.debt) > 0
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {parseFloat(log.debt) > 0 ? 'Reduced' : 'Increased'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            <span className={`font-medium ${
                              parseFloat(log.debt) > 0 ? 'text-green-700' : 'text-red-700'
                            }`}>
                              {Math.abs(parseFloat(log.debt))} {log.currency}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {log.debt_before !== null ? (
                              <span className="font-medium text-red-700">
                                {Math.round(log.debt_before)} {log.currency}
                              </span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {log.debt_after !== null ? (
                              <span className="font-medium text-green-700">
                                {Math.round(log.debt_after)} {log.currency}
                              </span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {log.admin_name || log.created_by_name || 'System'}
                          </td>
                          <td className="px-6 py-4 text-xs text-gray-500 max-w-xs break-words leading-tight" title={log.notes}>
                            {log.notes ? (
                              <span dangerouslySetInnerHTML={{ __html: log.notes.replace(/\n/g, '<br>') }} />
                            ) : (
                              '-'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12">
                  <FileText className="mx-auto h-12 w-12 text-gray-400" />
                  <h3 className="mt-2 text-sm font-medium text-gray-900">No debt reduction logs found</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Manual debt adjustments will appear here.
                  </p>
                </div>
              )}
            </div>

            {/* Footer with Pagination */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
              {/* Pagination Info */}
              <div className="text-sm text-gray-500">
                Page {logsPagination.currentPage} of {logsPagination.totalPages}
                ({logsPagination.totalRecords} total logs)
              </div>

              {/* Pagination Controls */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => fetchDebtLogs(logsPagination.currentPage - 1)}
                  disabled={!logsPagination.hasPreviousPage || loadingLogs}
                  className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 rounded border disabled:cursor-not-allowed"
                >
                  Previous
                </button>

                <button
                  onClick={() => fetchDebtLogs(logsPagination.currentPage + 1)}
                  disabled={!logsPagination.hasNextPage || loadingLogs}
                  className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 disabled:text-gray-400 rounded border disabled:cursor-not-allowed"
                >
                  Next
                </button>

                <button
                  onClick={closeLogsModal}
                  className="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors ml-4"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 !mt-0">
          <div className="relative top-10 mx-auto p-6 border w-11/12 max-w-md shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium text-gray-900">Create New Client</h3>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={createUserForm.name}
                    onChange={(e) => setCreateUserForm({ ...createUserForm, name: e.target.value })}
                    className="input w-full"
                    placeholder="Enter client name"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={createUserForm.phone}
                    onChange={(e) => setCreateUserForm({ ...createUserForm, phone: e.target.value })}
                    className="input w-full"
                    placeholder="Enter phone number (optional)"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={createUserForm.email}
                    onChange={(e) => setCreateUserForm({ ...createUserForm, email: e.target.value })}
                    className="input w-full"
                    placeholder="Enter email (optional)"
                  />
                </div>
              </div>

              <div className="flex space-x-3 pt-6">
                <button
                  onClick={createUser}
                  className="btn-primary flex-1"
                  disabled={!createUserForm.name.trim()}
                >
                  Create Client
                </button>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsersList; 

