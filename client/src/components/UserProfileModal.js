import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  X,
  User,
  Mail,
  Calendar,
  Banknote,
  CreditCard,
  Wallet,
  ShoppingCart,
  CheckCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  FileText,
  Camera
} from 'lucide-react';
import LoadingSpinner from './LoadingSpinner';
import toast from 'react-hot-toast';

const UserProfileModal = ({ isOpen, onClose, userId, onDeleteUser }) => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedOrders, setExpandedOrders] = useState(new Set());
  const [debtReductionEUR, setDebtReductionEUR] = useState('');
  const [debtReductionEUR_MKD, setDebtReductionEUR_MKD] = useState(''); // MKD input for EUR debt reduction
  const [debtReductionMKD, setDebtReductionMKD] = useState(''); // MKD input for MKD debt reduction
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [exchangeRate, setExchangeRate] = useState(61.5); // Default fallback

  const fetchUserProfile = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`/api/users/${userId}/profile`);
      setProfile(response.data);
    } catch (error) {
      console.error('Error fetching user profile:', error);
      toast.error('Failed to fetch user profile');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const fetchExchangeRate = useCallback(async () => {
    try {
      const response = await axios.get('/api/settings');
      if (response.data.exchange_rate) {
        setExchangeRate(response.data.exchange_rate);
      }
    } catch (error) {
      console.error('Error fetching exchange rate:', error);
      // Keep default value if fetch fails
    }
  }, []);

  useEffect(() => {
    if (isOpen && userId) {
      fetchUserProfile();
      fetchExchangeRate();
    }
  }, [isOpen, userId, fetchUserProfile, fetchExchangeRate]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscKey = (event) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscKey);
    }

    return () => {
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [isOpen, onClose]);

  // Refresh profile when a new order is created for this client
  useEffect(() => {
    if (!isOpen) return;
    const handleOrderCreated = (event) => {
      try {
        const { clientId } = event.detail || {};
        if (clientId === userId) {
          fetchUserProfile();
        }
      } catch (_) {}
    };
    window.addEventListener('orderCreated', handleOrderCreated);
    return () => window.removeEventListener('orderCreated', handleOrderCreated);
  }, [isOpen, userId, fetchUserProfile]);

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'completed': return 'badge bg-green-100 text-green-800';
      case 'pending': return 'badge bg-red-100 text-red-800';
      case 'shipped': return 'badge bg-blue-100 text-blue-800';
      default: return 'badge bg-gray-100 text-gray-800';
    }
  };


  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
  };

  const toggleOrderExpansion = (orderId) => {
    setExpandedOrders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      await axios.put(`/api/orders/${orderId}`, { status: newStatus });
      
      // Update the local state
      setProfile(prev => ({
        ...prev,
        orders: prev.orders.map(order => 
          order.id === orderId 
            ? { ...order, status: newStatus }
            : order
        ),
        financialSummary: {
          ...prev.financialSummary,
          // Update counts based on new status
          pendingOrders: prev.orders.filter(o => o.id !== orderId && o.status === 'pending').length + (newStatus === 'pending' ? 1 : 0),
          shippedOrders: prev.orders.filter(o => o.id !== orderId && o.status === 'shipped').length + (newStatus === 'shipped' ? 1 : 0),
          completedOrders: prev.orders.filter(o => o.id !== orderId && o.status === 'completed').length + (newStatus === 'completed' ? 1 : 0),
        }
      }));
      
      toast.success('Order status updated successfully');
    } catch (error) {
      console.error('Error updating order status:', error);
      toast.error('Failed to update order status');
    }
  };

  const generateInvoice = async (orderId) => {
    try {
      const response = await axios.get(`/api/orders/${orderId}/invoice`, {
        responseType: 'blob'
      });
      
      // Create a blob URL and download the PDF
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `invoice-${orderId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast.success('Invoice generated successfully');
    } catch (error) {
      console.error('Error generating invoice:', error);
      toast.error('Failed to generate invoice');
    }
  };



  const reduceDebt = async (currency) => {
    try {
      if (currency === 'EUR') {
        // Process EUR debt reduction with both EUR and MKD inputs
        const eurAmount = debtReductionEUR && debtReductionEUR.trim() !== '' ? parseFloat(debtReductionEUR) : null;
        const mkdAmount = debtReductionEUR_MKD && debtReductionEUR_MKD.trim() !== '' ? parseFloat(debtReductionEUR_MKD) : null;

        if ((eurAmount === null || isNaN(eurAmount)) && (mkdAmount === null || isNaN(mkdAmount))) {
          toast.error('Please enter at least one valid amount for EUR debt reduction');
          return;
        }

        // Calculate total EUR reduction and create consolidated note
        let totalEurReduction = 0;
        let noteParts = [];

        // Process EUR payment
        if (eurAmount !== null && !isNaN(eurAmount)) {
          const eurAdjustment = Math.ceil(eurAmount); // Round up for EUR
          totalEurReduction += eurAdjustment;
          if (eurAdjustment > 0) {
            noteParts.push(`EUR debt reduced by ${eurAdjustment} EUR (paid with EUR)`);
          } else {
            noteParts.push(`EUR debt increased by ${Math.abs(eurAdjustment)} EUR (added with EUR)`);
          }
        }

        // Process MKD payment for EUR debt
        if (mkdAmount !== null && !isNaN(mkdAmount)) {
          const eurEquivalent = mkdAmount / exchangeRate;
          const mkdAdjustment = Math.floor(eurEquivalent); // Round down for MKD to EUR conversion
          totalEurReduction += mkdAdjustment;
          if (mkdAdjustment > 0) {
            noteParts.push(`EUR debt reduced by ${mkdAdjustment} EUR (paid with ${mkdAmount} MKD at 1:${exchangeRate} rate)`);
          } else {
            noteParts.push(`EUR debt increased by ${Math.abs(mkdAdjustment)} EUR (added ${Math.abs(mkdAmount)} MKD at 1:${exchangeRate} rate)`);
          }
        }

        // Create consolidated note with line breaks
        const consolidatedNote = noteParts.join('.\n');

        // Make single API call with consolidated adjustment
        if (totalEurReduction !== 0) {
          await axios.put(`/api/users/${userId}/debt`, {
            debt: totalEurReduction,
            adjustment_type: 'manual_reduction',
            currency: 'EUR',
            notes: consolidatedNote
          });
        }

        // Clear input fields
        setDebtReductionEUR('');
        setDebtReductionEUR_MKD('');

        // Show success message
        if (totalEurReduction > 0) {
          toast.success(`EUR debt reduced by ${totalEurReduction} EUR`);
        } else if (totalEurReduction < 0) {
          toast.success(`EUR debt increased by ${Math.abs(totalEurReduction)} EUR`);
        }
      } else if (currency === 'MKD') {
        // Process MKD debt reduction (separate from EUR debt reduction)
        const mkdAmount = parseFloat(debtReductionMKD);
        if (isNaN(mkdAmount)) {
          toast.error('Please enter a valid MKD amount');
          return;
        }

        const mkdAdjustment = Math.ceil(mkdAmount);
        await axios.put(`/api/users/${userId}/debt`, {
          debt: mkdAdjustment,
          adjustment_type: 'manual_reduction',
          currency: 'MKD',
          notes: mkdAmount > 0
            ? `MKD debt reduced by ${mkdAdjustment} MKD`
            : `MKD debt increased by ${Math.abs(mkdAdjustment)} MKD`
        });

        setDebtReductionMKD('');

        if (mkdAdjustment > 0) {
          toast.success(`MKD debt reduced by ${mkdAdjustment} MKD`);
        } else {
          toast.success(`MKD debt increased by ${Math.abs(mkdAdjustment)} MKD`);
        }
      }

      // Refresh the profile to get updated debt calculation
      await fetchUserProfile();
    } catch (error) {
      console.error('Error adjusting debt:', error);
      toast.error('Failed to adjust debt');
    }
  };

  const handleDeleteUser = () => {
    if (deleteConfirmText.toLowerCase() === 'delete') {
      onDeleteUser(userId, profile?.user?.name);
      onClose();
    } else {
      toast.error('Please type "delete" to confirm');
    }
  };

  const captureDebtTile = async () => {
    try {
      // Find the preview section within the debt tile
      const previewSection = document.querySelector('[data-debt-preview]');
      if (!previewSection) {
        toast.error('Debt preview section not found');
        return;
      }

      // Use html2canvas to capture only the preview section
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(previewSection, {
        backgroundColor: '#ffffff',
        scale: 2, // Higher resolution
        useCORS: true,
        allowTaint: true,
        height: previewSection.scrollHeight + 20, // Add extra height to prevent cutoff
        width: previewSection.scrollWidth + 40,   // Use original width
        scrollX: 0,
        scrollY: 0,
        x: -20, // Offset to the left to create left padding
        y: 0
      });

      // Convert canvas to blob
      canvas.toBlob(async (blob) => {
        if (!blob) {
          toast.error('Failed to capture image');
          return;
        }

        // Try native share first (mobile devices)
        try {
          const file = new File([blob], `debt-tile-${profile?.user?.name || 'user'}.png`, { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: `Debt Information - ${profile?.user?.name || 'User'}`,
              text: `Debt information for ${profile?.user?.name || 'user'}`
            });
            toast.success('Debt tile shared successfully!');
            return;
          }
        } catch (shareErr) {
          console.log('Native share failed, falling back to copy:', shareErr);
        }

        // Fallback: Copy to clipboard
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'image/png': blob
            })
          ]);
          toast.success('Debt tile copied to clipboard!');
        } catch (clipboardErr) {
          console.log('Clipboard failed, falling back to download:', clipboardErr);
          
          // Final fallback: Download the image
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `debt-tile-${profile?.user?.name || 'user'}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          
          toast.success('Debt tile downloaded!');
        }
      }, 'image/png');
    } catch (error) {
      console.error('Error capturing debt tile:', error);
      toast.error('Failed to capture debt tile');
    }
  };

  // Reset delete confirmation state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setShowDeleteConfirm(false);
      setDeleteConfirmText('');
      setDebtReductionEUR('');
      setDebtReductionEUR_MKD('');
      setDebtReductionMKD('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 p-4 pt-8 !mt-0">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-full bg-primary-100 flex items-center justify-center">
              <User className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {profile?.user?.name || 'User Profile'}
              </h2>
              <p className="text-sm text-gray-500">Client Profile & Orders</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Delete User Section - Below Header */}
        {onDeleteUser && (
          <div className="px-6 py-1 border-b border-gray-200 bg-red-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center">
                  <svg className="h-4 w-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <div>
                  {profile?.financialSummary?.totalDebt === 0 && (
                    <p className="text-xs text-red-600">Delete this user account permanently</p>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-3">
                {profile?.financialSummary?.totalDebt > 0 ? (
                  <div className="text-sm text-red-600 bg-red-100 px-3 py-1 rounded border border-red-200">
                    Cannot delete user with debt!
                  </div>
                ) : !showDeleteConfirm ? (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="btn-danger text-sm px-3 py-1"
                    title="Delete User"
                  >
                    Delete
                  </button>
                ) : (
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder="Type 'delete' to confirm"
                      className="px-3 py-1 text-sm border border-red-300 rounded focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <button
                      onClick={handleDeleteUser}
                      disabled={deleteConfirmText.toLowerCase() !== 'delete'}
                      className="btn-danger text-sm px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Confirm Delete
                    </button>
                    <button
                      onClick={() => {
                        setShowDeleteConfirm(false);
                        setDeleteConfirmText('');
                      }}
                      className="btn-secondary text-sm px-3 py-1"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="p-8">
            <LoadingSpinner size="lg" />
          </div>
        ) : profile ? (
          <div className="flex flex-col flex-1 min-h-0">
            {/* Tabs */}
            <div className="border-b border-gray-200 flex-shrink-0">
              <nav className="flex space-x-8 px-6">
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'overview'
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setActiveTab('orders')}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === 'orders'
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  Orders ({profile.orders.length})
                </button>
              </nav>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === 'overview' && (
                <div className="space-y-4">
                  {/* User Info */}
                  <div className="card">
                    <div className="card-header">
                      <h3 className="text-lg font-medium text-gray-900">User Information</h3>
                    </div>
                    <div className="card-body">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="flex items-center space-x-3">
                          <User className="h-5 w-5 text-gray-400" />
                          <div>
                            <p className="text-sm font-medium text-gray-500">Name</p>
                            <p className="text-sm text-gray-900">{profile.user.name}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-3">
                          <Mail className="h-5 w-5 text-gray-400" />
                          <div>
                            <p className="text-sm font-medium text-gray-500">Email</p>
                            <p className="text-sm text-gray-900">{profile.user.email || 'Not provided'}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-3">
                          <div className="h-5 w-5 text-gray-400">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-500">Phone</p>
                            <p className="text-sm text-gray-900">{profile.user.phone || 'Not provided'}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-3">
                          <Calendar className="h-5 w-5 text-gray-400" />
                          <div>
                            <p className="text-sm font-medium text-gray-500">Joined</p>
                            <p className="text-sm text-gray-900">{formatDate(profile.user.created_at)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Financial Summary */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
                    <div className="card sm:col-span-2">
                      <div className="card-body">
                        <dl>
                          <dt className="flex items-center text-sm font-medium text-green-600 truncate bg-green-50 px-2 py-1 rounded">
                            <Banknote className="h-4 w-4 mr-2" />
                            Total Paid
                          </dt>
                          <dd className="mt-2 text-sm text-gray-900 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-gray-600">EUR</span>
                              <span className="font-medium bg-green-50 text-green-700 px-2 py-1 rounded">
                                {Math.round(profile.financialSummary.eurRevenue || 0)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-gray-600">MKD</span>
                              <span className="font-medium bg-green-50 text-green-700 px-2 py-1 rounded">
                                {Math.round(profile.financialSummary.mkdRevenue || 0)}
                              </span>
                            </div>
                          </dd>
                        </dl>
                      </div>
                    </div>

                    <div className="card sm:col-span-2 relative" data-debt-tile>
                      <div className="card-body">
                        <dl>
                          <dt className="flex items-center text-sm font-medium text-red-600 truncate bg-red-50 px-2 py-1 rounded">
                            <CreditCard className="h-4 w-4 mr-2" />
                            Debt
                          </dt>
                          <dd className="mt-2 text-sm text-gray-900 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-gray-600">EUR</span>
                              <span className="font-medium bg-red-50 text-red-700 px-2 py-1 rounded">
                                {Math.round(profile.financialSummary.eurDebt || 0)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-gray-600">MKD</span>
                              <span className="font-medium bg-red-50 text-red-700 px-2 py-1 rounded">
                                {Math.round(profile.financialSummary.mkdDebt || 0)}
                              </span>
                            </div>

                            {/* Enhanced Debt Reduction Preview - Shows when input fields are filled */}
                            {((debtReductionEUR && debtReductionEUR.trim() !== '' && !isNaN(parseFloat(debtReductionEUR))) ||
                              (debtReductionEUR_MKD && debtReductionEUR_MKD.trim() !== '' && !isNaN(parseFloat(debtReductionEUR_MKD)))) && (
                              <div className="mt-3 pt-2 border-t border-gray-200" data-debt-preview>
                                <div className="text-xs text-gray-500 mb-2">Preview:</div>

                                {/* EUR Input Preview */}
                                {debtReductionEUR && debtReductionEUR.trim() !== '' && !isNaN(parseFloat(debtReductionEUR)) && (
                                  <div className="text-xs mb-1">
                                    <div className="flex items-center justify-between">
                                      <span className="text-gray-900 font-medium">EUR Payment:</span>
                                      <span className="text-gray-900 font-medium">
                                        {(() => {
                                          const amount = Math.ceil(parseFloat(debtReductionEUR));
                                          return `${amount} EUR`;
                                        })()}
                                      </span>
                                    </div>
                                  </div>
                                )}

                                {/* MKD Input Preview */}
                                {debtReductionEUR_MKD && debtReductionEUR_MKD.trim() !== '' && !isNaN(parseFloat(debtReductionEUR_MKD)) && (
                                  <div className="text-xs mb-1">
                                    <div className="flex items-center justify-between">
                                      <span className="text-gray-900 font-medium">MKD Payment:</span>
                                      <span className="text-gray-900 font-medium">
                                        {(() => {
                                          const mkdAmount = parseFloat(debtReductionEUR_MKD);
                                          const eurAmount = Math.floor(mkdAmount / exchangeRate);
                                          return `${mkdAmount} MKD → ${eurAmount} EUR`;
                                        })()}
                                      </span>
                                    </div>
                                  </div>
                                )}

                                {/* Total Payment Summary */}
                                {((debtReductionEUR && debtReductionEUR.trim() !== '' && !isNaN(parseFloat(debtReductionEUR))) ||
                                  (debtReductionEUR_MKD && debtReductionEUR_MKD.trim() !== '' && !isNaN(parseFloat(debtReductionEUR_MKD)))) && (
                                  <div className="text-xs mb-1">
                                    <div className="flex items-center justify-between font-medium border-t border-gray-300 pt-1">
                                      <span className="text-gray-900">Total Payment:</span>
                                      <span className="text-gray-900">
                                        {(() => {
                                          const eurAmount = debtReductionEUR && debtReductionEUR.trim() !== '' && !isNaN(parseFloat(debtReductionEUR))
                                            ? Math.ceil(parseFloat(debtReductionEUR))
                                            : 0;
                                          const mkdAmount = debtReductionEUR_MKD && debtReductionEUR_MKD.trim() !== '' && !isNaN(parseFloat(debtReductionEUR_MKD))
                                            ? Math.floor(parseFloat(debtReductionEUR_MKD) / exchangeRate)
                                            : 0;
                                          const totalEUR = eurAmount + mkdAmount;
                                          return `${totalEUR} EUR`;
                                        })()}
                                      </span>
                                    </div>
                                  </div>
                                )}

                                {/* Combined EUR Debt Result */}
                                {((debtReductionEUR && debtReductionEUR.trim() !== '' && !isNaN(parseFloat(debtReductionEUR))) ||
                                  (debtReductionEUR_MKD && debtReductionEUR_MKD.trim() !== '' && !isNaN(parseFloat(debtReductionEUR_MKD)))) && (
                                  <div className="text-xs pt-1 border-t border-gray-300">
                                    <div className="flex items-center justify-between font-medium">
                                      <span className="text-blue-700">Total Debt EUR:</span>
                                      <span className="text-blue-700">
                                        {(() => {
                                          const currentDebt = Math.round(profile.financialSummary.eurDebt || 0);
                                          const eurReduction = debtReductionEUR && debtReductionEUR.trim() !== '' && !isNaN(parseFloat(debtReductionEUR))
                                            ? Math.ceil(parseFloat(debtReductionEUR))
                                            : 0;
                                          const mkdReduction = debtReductionEUR_MKD && debtReductionEUR_MKD.trim() !== '' && !isNaN(parseFloat(debtReductionEUR_MKD))
                                            ? Math.floor(parseFloat(debtReductionEUR_MKD) / exchangeRate)
                                            : 0;
                                          const totalReduction = eurReduction + mkdReduction;
                                          const newDebt = Math.max(0, currentDebt - totalReduction);
                                          return `${currentDebt} EUR → ${newDebt} EUR`;
                                        })()}
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </dd>
                        </dl>
                      </div>
                      
                      {/* Camera Icon */}
                      <button
                        onClick={captureDebtTile}
                        className="absolute bottom-2 right-2 p-2 bg-white hover:bg-gray-50 rounded-full shadow-md border border-gray-200 transition-colors group"
                        title="Capture debt tile image"
                      >
                        <Camera className="h-4 w-4 text-gray-600 group-hover:text-gray-800" />
                      </button>
                    </div>

                    {/* Reduce Debt Section - Spans 2 columns on large screens */}
                    <div className="card sm:col-span-2">
                      <div className="card-body">
                        <dl>
                          <dt className="flex items-center text-sm font-medium text-blue-600 truncate bg-blue-50 px-2 py-1 rounded">
                            <Wallet className="h-4 w-4 mr-2" />
                            Reduce Debt
                          </dt>
                          <dd className="mt-2 text-sm text-gray-900 space-y-4">
                            {/* EUR Debt Reduction */}
                            <div className="space-y-2">
                              <div className="text-xs text-gray-600 font-medium">Reduce EUR Debt</div>

                              {/* Two input fields for EUR debt reduction */}
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-600 w-12 shrink-0">EUR:</span>
                                  <input
                                    type="number"
                                    value={debtReductionEUR}
                                    onChange={(e) => setDebtReductionEUR(e.target.value)}
                                    placeholder="+/- amount"
                                    className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    step="1"
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-600 w-12 shrink-0">MKD:</span>
                                  <input
                                    type="number"
                                    value={debtReductionEUR_MKD}
                                    onChange={(e) => setDebtReductionEUR_MKD(e.target.value)}
                                    placeholder="+/- amount"
                                    className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    step="1"
                                  />
                                </div>
                              </div>

                              {/* Single Apply Button for EUR Debt Reduction */}
                              <div className="flex justify-end">
                                <button
                                  onClick={() => reduceDebt('EUR')}
                                  disabled={(!debtReductionEUR || isNaN(parseFloat(debtReductionEUR))) &&
                                           (!debtReductionEUR_MKD || isNaN(parseFloat(debtReductionEUR_MKD)))}
                                  className="px-4 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
                                >
                                  Apply EUR
                                </button>
                              </div>


                            </div>

                            <div className="border-t border-gray-200 pt-3"></div>

                            {/* MKD Debt Reduction */}
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-600 font-medium">Reduce MKD Debt</span>
                                <span className="text-xs text-gray-500">(MKD only)</span>
                              </div>

                              <div className="flex items-center gap-2 w-full">
                                <span className="text-xs text-gray-600 w-16 shrink-0">MKD</span>
                                <input
                                  type="number"
                                  value={debtReductionMKD}
                                  onChange={(e) => setDebtReductionMKD(e.target.value)}
                                  placeholder="+/- amount"
                                  className="flex-1 min-w-0 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                                  step="1"
                                />
                                <button
                                  onClick={() => reduceDebt('MKD')}
                                  disabled={!debtReductionMKD || isNaN(parseFloat(debtReductionMKD))}
                                  className="shrink-0 px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                                >
                                  Apply
                                </button>
                              </div>
                            </div>
                          </dd>
                        </dl>
                      </div>
                    </div>
                  </div>

                  {/* Order Status Summary */}
                  <div className="card">
                    <div className="card-header">
                      <h3 className="text-lg font-medium text-gray-900">Order Status Summary</h3>
                    </div>
                    <div className="card-body">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                          <div className="flex items-center space-x-3">
                            <Clock className="h-5 w-5 text-yellow-600" />
                            <span className="text-sm font-medium text-gray-900">Pending</span>
                          </div>
                          <span className="text-lg font-semibold text-yellow-600">
                            {profile.financialSummary.pendingOrders}
                          </span>
                        </div>

                        <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                          <div className="flex items-center space-x-3">
                            <CheckCircle className="h-5 w-5 text-green-600" />
                            <span className="text-sm font-medium text-gray-900">Completed</span>
                          </div>
                          <span className="text-lg font-semibold text-green-600">
                            {profile.financialSummary.completedOrders}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'orders' && (
                <div className="space-y-3">
                  {profile.orders.length > 0 ? (
                    profile.orders.map((order) => {
                      const isExpanded = expandedOrders.has(order.id);
                      const totalItems = order.items?.length || 0;
                      
                      return (
                        <div key={order.id} className="border border-gray-200 rounded-lg overflow-hidden">
                          {/* Order Header - Always Visible */}
                          <div 
                            className="bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                            onClick={() => toggleOrderExpansion(order.id)}
                          >
                            <div className="overflow-x-auto">
                              <div className="flex items-center justify-between py-2 px-2">
                                <div className="flex items-center space-x-3 sm:space-x-6">
                                  <div className="flex items-center space-x-2">
                                    <select
                                      value={order.status}
                                      onChange={(e) => updateOrderStatus(order.id, e.target.value)}
                                      className={`${getStatusBadgeClass(order.status)} border-0 cursor-pointer focus:ring-2 focus:ring-primary-500 focus:outline-none`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <option value="pending" className="bg-yellow-100 text-yellow-800">Pending</option>
                                      <option value="completed" className="bg-green-100 text-green-800">Completed</option>
                                    </select>
                                  </div>
                                  <div className="text-sm text-gray-500 whitespace-nowrap flex flex-col leading-tight">
                                    <span>{formatDate(order.created_at)}</span>
                                    <span className="text-xs text-gray-400">
                                      {new Date(order.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-3">
                                  <div className="flex flex-col sm:flex-row items-end space-y-1 sm:space-y-0 sm:space-x-2">
                                    {(() => {
                                      const eurTotal = order.items?.reduce((sum, item) => 
                                        item.category === 'smartphones' ? sum + (item.quantity * item.price) : sum, 0) || 0;
                                      const mkdTotal = order.items?.reduce((sum, item) => 
                                        item.category !== 'smartphones' ? sum + (item.quantity * item.price) : sum, 0) || 0;
                                      
                                      return (
                                        <>
                                          {eurTotal > 0 && (
                                            <span className="text-xs font-medium text-blue-700 bg-blue-50 px-2 py-1 rounded border border-blue-200">
                                              € {Math.round(eurTotal)}
                                            </span>
                                          )}
                                          {mkdTotal > 0 && (
                                            <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded border border-green-200">
                                              {Math.round(mkdTotal)} MKD
                                            </span>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>
                                  <div className="flex-shrink-0">
                                    {isExpanded ? (
                                      <ChevronUp className="h-4 w-4 text-gray-600" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4 text-gray-600" />
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          {/* Order Details - Expandable */}
                          {isExpanded && (
                            <div className="bg-white px-4 py-4 border-t border-gray-200">
                              <div className="flex items-center justify-between mb-3">
                                <h5 className="text-sm font-medium text-gray-900 flex items-center">
                                  <ShoppingCart className="h-4 w-4 mr-2" />
                                  Order Items
                                </h5>
                                <div className="flex items-center space-x-4 text-sm text-gray-500">
                                  <span className="font-medium text-gray-900">Order #{order.id}</span>
                                  <span>{totalItems} item{totalItems !== 1 ? 's' : ''}</span>
                                </div>
                              </div>
                              <div className="space-y-3">
                                {order.items && order.items.length > 0 ? (
                                  order.items.map((item, index) => (
                                    <div key={index} className="overflow-x-auto">
                                      <div className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg">
                                        <div className="flex items-center space-x-3">
                                          <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium text-gray-900 truncate">
                                              {item.product_name}
                                            </p>
                                            <p className="text-xs text-gray-500">
                                              Quantity: {item.quantity}
                                            </p>
                                          </div>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                          <span className="text-sm font-medium text-gray-900">
                                            {Math.round(item.price)} {item.category === 'smartphones' ? 'EUR' : 'MKD'}
                                          </span>
                                          <p className="text-xs text-gray-500">
                                            Total: {Math.round(item.price * item.quantity)} {item.category === 'smartphones' ? 'EUR' : 'MKD'}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className="text-center py-4 text-sm text-gray-500">
                                    No items found for this order
                                  </div>
                                )}
                              </div>
                              
                              {/* Generate Invoice Button */}
                              <div className="flex justify-end mt-4 pt-4 border-t border-gray-200">
                                <button
                                  onClick={() => generateInvoice(order.id)}
                                  className="btn btn-primary flex items-center justify-center space-x-2 text-sm"
                                >
                                  <FileText className="h-3 w-3" />
                                  <span>Generate Invoice</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-12">
                      <ShoppingCart className="mx-auto h-12 w-12 text-gray-400" />
                      <h3 className="mt-2 text-sm font-medium text-gray-900">No orders found</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        This user hasn't placed any orders yet.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="text-gray-500">Failed to load user profile</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserProfileModal; 