import React, { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { getEffectiveAuthToken } from '../utils/authSession';
import Pagination from '../components/Pagination';
import './RestorePage.css';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

function RestorePage() {
  const [session, setSession] = useState(null);
  const [restoreItems, setRestoreItems] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadEtaSeconds, setUploadEtaSeconds] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [expandedFeatureRows, setExpandedFeatureRows] = useState({});
  const [restoreCurrentPage, setRestoreCurrentPage] = useState(1);
  const fileInputRef = useRef(null);
  const restorePageSize = 10;

  const token = typeof window !== 'undefined' ? getEffectiveAuthToken() : null;

  // Load current restore session - runs when token becomes available or changes
  useEffect(() => {
    if (token) {
      loadRestoreSession();
      loadRestoreHistory();
    }
  }, [token]);

  useEffect(() => {
    if (!token || (!loading && !uploading)) return undefined;

    const progressTimer = window.setInterval(() => {
      loadRestoreSession();
    }, 1000);

    return () => window.clearInterval(progressTimer);
  }, [loading, token, uploading]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(restoreItems.length / restorePageSize));
    setRestoreCurrentPage((page) => Math.min(page, totalPages));
  }, [restoreItems.length]);

  const loadRestoreSession = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/admin/restore/session`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSession(res.data.session || null);
      setRestoreItems(res.data.items || []);
    } catch (err) {
      if (err.response?.status !== 404) {
        console.error('Failed to load restore session', err);
      }
    }
  };

  const loadRestoreHistory = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/admin/restore/history`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setHistory(res.data || []);
    } catch (err) {
      console.error('Failed to load restore history', err);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.gfxbackup')) {
      toast.error('Please select a .gfxbackup file');
      return;
    }

    setSelectedFile(file);
  };

  const handleUploadAndAnalyze = async () => {
    if (!selectedFile) {
      toast.error('Please select a file first');
      return;
    }

    // Start a completely new restore comparison session.
    // This prevents old backup changes from being mixed with the new package.
    setSession(null);
    setRestoreItems([]);
    setRestoreCurrentPage(1);

    const uploadStartedAt = Date.now();
    setUploading(true);
    setUploadProgress(0);
    setUploadEtaSeconds(null);
    const formData = new FormData();
    formData.append('backup', selectedFile);

    try {
      const res = await axios.post(
        `${API_BASE_URL}/admin/restore/upload`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data'
          },
          onUploadProgress: (progressEvent) => {
            const loaded = Number(progressEvent.loaded || 0);
            const total = Number(progressEvent.total || selectedFile.size || 0);
            if (!total) return;
            const percent = Math.min(100, Math.round((loaded / total) * 100));
            setUploadProgress(percent);
            const elapsedSeconds = Math.max(0.001, (Date.now() - uploadStartedAt) / 1000);
            const bytesPerSecond = loaded / elapsedSeconds;
            setUploadEtaSeconds(bytesPerSecond > 0 ? Math.ceil((total - loaded) / bytesPerSecond) : null);
          }
        }
      );

      setSession(res.data.session);
      setRestoreItems(res.data.items || []);
      setSelectedFile(null);
      await loadRestoreHistory();
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      toast.success(`Analyzed ${res.data.items?.length || 0} changes`);
    } catch (err) {
      console.error('Upload failed', err);
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadEtaSeconds(null);
    }
  };

  const handleUpdateItem = async (itemId) => {
    try {
      setLoading(true);
      const res = await axios.post(
        `${API_BASE_URL}/admin/restore/item/${itemId}`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      // Update local state
      setRestoreItems(
        restoreItems.map((item) =>
          item.id === itemId ? { ...item, status: 'completed' } : item
        )
      );

      // Update session counts
      if (session) {
        setSession({
          ...session,
          completed_items: session.completed_items + 1,
          pending_items: Math.max(0, session.pending_items - 1)
        });
      }

      toast.success('Item updated successfully');
    } catch (err) {
      console.error('Update failed', err);
      toast.error(err.response?.data?.error || 'Update failed');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateAll = async () => {
    if (!window.confirm('Update all safe items? This cannot be undone.')) {
      return;
    }

    try {
      setLoading(true);
      const res = await axios.post(
        `${API_BASE_URL}/admin/restore/all`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      await loadRestoreSession();
      toast.success(`Updated ${res.data.updated || 0} items`);
    } catch (err) {
      console.error('Batch update failed', err);
      toast.error(err.response?.data?.error || 'Batch update failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRepairSession = async () => {
    const confirmed = window.confirm(
      'Repair stale or incomplete restore state?\n\nThis will reset the current session to a safe review state and keep the backup history intact.\n\n[ CANCEL ] [ REPAIR SESSION ]'
    );

    if (!confirmed) {
      return;
    }

    try {
      const res = await axios.post(
        `${API_BASE_URL}/admin/restore/repair`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      if (res.data?.repaired) {
        await loadRestoreSession();
        toast.success('Restore session repaired and reset to a safe review state');
        return;
      }

      toast.info(res.data?.message || 'No stale restore session needed repair');
    } catch (err) {
      console.error('Repair failed', err);
      toast.error(err.response?.data?.error || 'Failed to repair restore session');
    }
  };

  const handleClearSession = async () => {
    const confirmed = window.confirm(
      'Are you sure?\n\nThis will clear the current restore comparison.\nThe uploaded backup file will remain in Restore History.\n\n[ CANCEL ] [ CLEAR CURRENT RESTORE ]'
    );

    if (!confirmed) {
      return;
    }

    try {
      await axios.post(
        `${API_BASE_URL}/admin/restore/clear`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      setSession(null);
      setRestoreItems([]);
      toast.success('Restore session cleared');
    } catch (err) {
      console.error('Clear failed', err);
      toast.error(err.response?.data?.error || 'Failed to clear session');
    }
  };

  const handleDeleteHistoryFile = async (entry) => {
    const backupFileName = entry?.backup_filename || entry?.name || entry?.id || 'this restore backup';
    const confirmed = window.confirm(
      `Delete this restore backup?\n\n${backupFileName}\n\nThis will permanently remove the stored restore package.\n\n[ CANCEL ] [ DELETE ]`
    );

    if (!confirmed) {
      return;
    }

    try {
      await axios.delete(
        `${API_BASE_URL}/admin/restore/file/${encodeURIComponent(backupFileName)}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      setHistory(history.filter((h) => h.id !== entry.id && h.backup_filename !== backupFileName));
      toast.success('Restore file deleted');
    } catch (err) {
      console.error('Delete failed', err);
      toast.error(err.response?.data?.error || 'Failed to delete file');
    }
  };

  const handleReviewConflict = (item) => {
    const details = {
      feature: item.name,
      current: item.current_version || 'unknown',
      backup: item.backup_version || 'unknown',
      message: item.description || 'Local changes detected.'
    };

    toast.info(
      `${details.feature}\nCurrent: ${details.current}\nBackup: ${details.backup}\n${details.message}`,
      {
        autoClose: false,
        closeOnClick: false,
        draggable: false
      }
    );
  };

  const isCriticalRestoreState = Boolean(
    session && (
      ['failed'].includes(String(session.status || '').toLowerCase()) ||
      restoreItems.some((item) => ['failed'].includes(String(item.status || '').toLowerCase())) ||
      (Number(session.pending_items || 0) > Number(session.total_items || 0)) ||
      (session.comparison_result && ['failed'].includes(String(session.comparison_result.status || '').toLowerCase()))
    )
  );

  const hasRepairableSession = Boolean(
    session && (
      ['stale', 'failed', 'in_progress'].includes(String(session.status || '').toLowerCase()) ||
      restoreItems.some((item) => ['failed', 'stale', 'incomplete'].includes(String(item.status || '').toLowerCase())) ||
      (Number(session.pending_items || 0) > Number(session.total_items || 0)) ||
      (session.comparison_result && ['stale', 'failed'].includes(String(session.comparison_result.status || '').toLowerCase()))
    )
  );

  const repairSeverity = isCriticalRestoreState ? 'critical' : hasRepairableSession ? 'stale' : null;

  const repairNeededMessage = repairSeverity
    ? repairSeverity === 'critical'
      ? 'Immediate action required: this restore session is failed or inconsistent. Repair immediately before continuing.'
      : 'Repair needed: this restore session is stale or incomplete. Review and repair before continuing.'
    : null;

  const restoreProgress = session?.comparison_result || {};
  const sourceDatabase = restoreProgress.source_database || {};
  const targetDatabase = restoreProgress.target_database || {};
  const progressTotal = Number(restoreProgress.total_items || session?.total_items || 0);
  const progressFailed = Number(restoreProgress.failed_count || 0);
  const reportedProcessed = restoreProgress.processed_items !== undefined
    ? Number(restoreProgress.processed_items)
    : Number(session?.completed_items || 0) + progressFailed;
  const progressProcessed = Math.min(
    progressTotal,
    reportedProcessed
  );
  const progressPercent = progressTotal > 0
    ? Math.min(100, Math.round((progressProcessed / progressTotal) * 100))
    : 0;
  const estimatedSeconds = Number(restoreProgress.estimated_remaining_seconds);
  const analysisActive = uploading && String(restoreProgress.phase || '').toLowerCase() === 'analysis';
  const formatRemainingTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return 'Finishing...';
    if (seconds < 60) return `About ${seconds}s remaining`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `About ${minutes}m ${remainingSeconds}s remaining`;
  };

  const toggleFeatureRow = (itemId) => {
    setExpandedFeatureRows((prev) => ({
      ...prev,
      [itemId]: !prev[itemId]
    }));
  };

  const restoreTotalPages = Math.max(1, Math.ceil(restoreItems.length / restorePageSize));
  const restorePageItems = restoreItems.slice(
    (restoreCurrentPage - 1) * restorePageSize,
    restoreCurrentPage * restorePageSize
  );

  return (
    <div className="restore-page">
      {/* Upload Section */}
      <section className="restore-section">
        <h2>Upload Backup File</h2>
        <div className="restore-upload">
          <input
            ref={fileInputRef}
            type="file"
            accept=".gfxbackup"
            onChange={handleFileSelect}
            disabled={uploading}
          />
          <button
            onClick={handleUploadAndAnalyze}
            disabled={!selectedFile || uploading}
            className="btn-primary"
          >
            {uploading ? 'Uploading...' : 'Upload & Analyze'}
          </button>
          {selectedFile && <span className="file-name">{selectedFile.name}</span>}
        </div>
        {uploading && (
          <div className="restore-progress restore-transfer-progress" aria-live="polite">
            <div className="restore-progress-heading">
              <strong>{analysisActive ? 'Analyzing backup' : 'Uploading backup'}</strong>
              <span>{analysisActive ? `${progressProcessed} of ${progressTotal} items` : `${uploadProgress}% uploaded`}</span>
            </div>
            <div
              className="restore-progress-track"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={analysisActive ? progressPercent : uploadProgress}
              aria-label={analysisActive ? 'Backup analysis progress' : 'Backup upload progress'}
            >
              <div
                className="restore-progress-fill"
                style={{ width: `${analysisActive ? progressPercent : uploadProgress}%` }}
              />
            </div>
            <div className="restore-progress-meta">
              <span>{analysisActive ? `${progressPercent}% analyzed` : 'Transfer in progress'}</span>
              <span>{analysisActive ? formatRemainingTime(estimatedSeconds) : formatRemainingTime(uploadEtaSeconds)}</span>
            </div>
          </div>
        )}
      </section>

      {/* Current Restore Session */}
      {session && (
        <>
          {/* Premium Summary Card */}
          <section className="restore-summary">
            <div className="restore-summary-content">
              <div className="summary-stat">
                <div className="stat-icon">📊</div>
                <div className="stat-content">
                  <h4>Total Items</h4>
                  <div className="value">{session.total_items}</div>
                </div>
              </div>
              <div className="summary-stat">
                <div className="stat-icon">✨</div>
                <div className="stat-content">
                  <h4>New Items</h4>
                  <div className="value">{session.new_items || 0}</div>
                </div>
              </div>
              <div className="summary-stat">
                <div className="stat-icon">🔄</div>
                <div className="stat-content">
                  <h4>Updates</h4>
                  <div className="value">{session.updated_items || 0}</div>
                </div>
              </div>
              <div className="summary-stat">
                <div className="stat-icon">✅</div>
                <div className="stat-content">
                  <h4>Completed</h4>
                  <div className="value">{session.completed_items || 0}</div>
                </div>
              </div>
            </div>
            <div className={`restore-summary-message ${repairSeverity ? `severity-${repairSeverity}` : ''}`}>
              {repairSeverity === 'critical' ? '⛔' : '📦'} <strong>{session.backup_filename}</strong> — {repairSeverity ? (repairSeverity === 'critical' ? 'Immediate action required' : 'Repair needed') : 'Ready to restore'}
            </div>
            {(sourceDatabase.users !== undefined || sourceDatabase.images !== undefined) && (
              <div className="restore-compare-summary">
                <span><strong>Source users:</strong> {sourceDatabase.users ?? '—'}</span>
                <span><strong>PC1 users:</strong> {targetDatabase.users ?? '—'}</span>
                <span><strong>Source assets:</strong> {sourceDatabase.images ?? '—'}</span>
                <span><strong>PC1 assets:</strong> {targetDatabase.images ?? '—'}</span>
                <span><strong>New users:</strong> {restoreProgress.new_users ?? 0}</span>
                <span><strong>New assets:</strong> {restoreProgress.new_assets ?? 0}</span>
              </div>
            )}
            {repairNeededMessage && (
              <div className={`restore-repair-warning ${repairSeverity}`}>
                {repairSeverity === 'critical' ? '🚨' : '⚠️'} {repairNeededMessage}
              </div>
            )}
            {(loading || String(restoreProgress.status || '').toLowerCase() === 'in_progress') && (
              <div className="restore-progress" aria-live="polite">
                <div className="restore-progress-heading">
                  <strong>Restoring safe items</strong>
                  <span>{progressProcessed} of {progressTotal} items</span>
                </div>
                <div
                  className="restore-progress-track"
                  role="progressbar"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={progressPercent}
                  aria-label="Restore progress"
                >
                  <div className="restore-progress-fill" style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="restore-progress-meta">
                  <span>{progressPercent}% complete</span>
                  <span>{formatRemainingTime(estimatedSeconds)}</span>
                </div>
              </div>
            )}
          </section>

          <section className="restore-section">
            <div className="restore-header">
              <div>
                <h2>Comparison Details</h2>
              </div>
              <div className="restore-actions">
                {hasRepairableSession && (
                  <button
                    onClick={handleRepairSession}
                    disabled={loading}
                    className="btn-warning"
                  >
                    [ REPAIR STALE SESSION ]
                  </button>
                )}
                {restoreItems.some((item) => item.status === 'pending' && !['conflict', 'conflicted'].includes((item.change_type || item.changeType || '').toLowerCase())) && (
                  <button
                    onClick={handleUpdateAll}
                    disabled={loading}
                    className="btn-success"
                  >
                    [ UPDATE ALL SAFE ITEMS ]
                  </button>
                )}
                <button
                  onClick={handleClearSession}
                  className="btn-secondary"
                >
                  [ CLEAR CURRENT RESTORE ]
                </button>
              </div>
            </div>

            {/* Restore Items Table */}
            {restoreItems.length > 0 ? (
              <>
                {restoreItems.some((item) => item.status === 'pending' && !['conflict', 'conflicted'].includes((item.change_type || item.changeType || '').toLowerCase())) && (
                  <div className="restore-actions restore-actions-inline">
                    {hasRepairableSession && (
                      <button
                        onClick={handleRepairSession}
                        disabled={loading}
                        className="btn-warning"
                      >
                        [ REPAIR STALE SESSION ]
                      </button>
                    )}
                    <button
                      onClick={handleUpdateAll}
                      disabled={loading}
                      className="btn-success"
                    >
                      [ UPDATE ALL SAFE ITEMS ]
                    </button>
                  </div>
                )}
              <table className="restore-table">
                <colgroup>
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '28%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '9%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Type</th>
                    <th>Feature / File / Data</th>
                    <th>Current Version</th>
                    <th>Backup Version</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {restorePageItems.map((item, idx) => {
                    const isFeature = item.type === 'feature';
                    const isExpanded = Boolean(expandedFeatureRows[item.id]);
                    const relatedFiles = Array.isArray(item.related_files) ? item.related_files : Array.isArray(item.relatedFiles) ? item.relatedFiles : [];

                    return (
                      <React.Fragment key={item.id || `${item.type}-${idx}`}>
                        <tr
                          className={`item-${item.status} ${isFeature ? 'feature-row' : ''}`}
                          onClick={isFeature ? () => toggleFeatureRow(item.id) : undefined}
                          style={isFeature ? { cursor: 'pointer' } : undefined}
                        >
                          <td className="item-number" data-label="#">{((restoreCurrentPage - 1) * restorePageSize) + idx + 1}</td>
                          <td className="item-type" data-label="Type">{item.type.charAt(0).toUpperCase() + item.type.slice(1)}</td>
                          <td className="item-name" data-label="Item">
                            <div className="item-name-main">
                              {isFeature && (
                                <span className="feature-expand-indicator">{isExpanded ? '▾' : '▸'}</span>
                              )}
                              <span>{item.name}</span>
                            </div>
                            {isFeature ? (
                              <div className="item-description">Files affected: {relatedFiles.length || 0}</div>
                            ) : item.description ? (
                              <div className="item-description">{item.description}</div>
                            ) : null}
                            {((item.change_type || item.changeType || '').toString().toLowerCase() === 'conflict') && (
                              <div className="conflict-detail-box">
                                <div><strong>Current:</strong> {item.current_version || 'unknown'}</div>
                                <div><strong>Backup:</strong> {item.backup_version || 'unknown'}</div>
                                <div><strong>Local changes detected.</strong></div>
                              </div>
                            )}
                          </td>
                          <td className="item-current" data-label="Current">{item.current_version || '—'}</td>
                          <td className="item-backup" data-label="Backup">{item.backup_version || '—'}</td>
                          <td className="item-status" data-label="Status">
                            {item.status === 'completed' ? (
                              <span className="status-completed">COMPLETED ✓</span>
                            ) : ['failed', 'stale', 'incomplete'].includes(String(item.status || '').toLowerCase()) ? (
                              <span className="status-failed">FAILED</span>
                            ) : (item.change_type || item.changeType || '').toString().toLowerCase() === 'conflict' ? (
                              <span className="status-conflict">CONFLICT</span>
                            ) : (
                              <span className="status-pending">Pending</span>
                            )}
                          </td>
                          <td className="item-action" data-label="Action">
                            {item.status === 'completed' ? (
                              <span className="action-completed">COMPLETED ✓</span>
                            ) : ['failed', 'stale', 'incomplete'].includes(String(item.status || '').toLowerCase()) ? (
                              <span className="action-failed" title={item.error_message || 'This item needs repair'}>
                                {item.error_message || 'REPAIR NEEDED'}
                              </span>
                            ) : (item.change_type || item.changeType || '').toString().toLowerCase() === 'conflict' ? (
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleReviewConflict(item);
                                }}
                                className="btn-review"
                              >
                                REVIEW
                              </button>
                            ) : (
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleUpdateItem(item.id);
                                }}
                                disabled={loading}
                                className="btn-update"
                              >
                                {loading ? '...' : 'UPDATE'}
                              </button>
                            )}
                          </td>
                        </tr>
                        {isFeature && isExpanded && (
                          <tr className="feature-detail-row">
                            <td colSpan="7">
                              <div className="feature-files-box">
                                <div className="feature-files-title">Files in this feature</div>
                                <ul className="feature-files-list">
                                  {relatedFiles.map((filePath, fileIndex) => (
                                    <li key={`${item.id}-${fileIndex}`}>{filePath}</li>
                                  ))}
                                </ul>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              {restoreTotalPages > 1 && (
                <Pagination
                  currentPage={restoreCurrentPage}
                  totalPages={restoreTotalPages}
                  totalImages={restoreItems.length}
                  setCurrentPage={setRestoreCurrentPage}
                  darkMode={false}
                />
              )}
              </>
            ) : (
              <div className="restore-empty-state">
                <div className="restore-empty-state-content">
                  <div className="restore-empty-state-icon">✅</div>
                  <h3 className="restore-empty-state-title">Backup is Up-to-Date</h3>
                  <p className="restore-empty-state-message">
                    All items in the backup are identical to the current version.<br />
                    No restore actions required.
                  </p>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {/* Restore History */}
      <section className="restore-section">
        <h2>Restore History</h2>
        {history.length > 0 ? (
          <table className="restore-history-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Backup File</th>
                <th>Type</th>
                <th>Changes</th>
                <th>Completed</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {history.map((entry) => (
                <tr key={entry.id}>
                  <td data-label="Date">{new Date(entry.uploaded_at).toLocaleString()}</td>
                  <td className="filename" data-label="Backup File">{entry.backup_filename}</td>
                  <td data-label="Type">{entry.backup_type || '—'}</td>
                  <td className="number" data-label="Changes">{entry.total_changes || '—'}</td>
                  <td className="number" data-label="Completed">{entry.completed_changes || 0}</td>
                  <td data-label="Status">
                    <span className={`status-${entry.status}`}>
                      {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                    </span>
                  </td>
                  <td data-label="Action">
                    <button
                      onClick={() => handleDeleteHistoryFile(entry)}
                      className="btn-delete"
                      title="Delete this backup file"
                    >
                      DELETE
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="no-items">No restore history yet.</p>
        )}
      </section>
    </div>
  );
}

export default RestorePage;
