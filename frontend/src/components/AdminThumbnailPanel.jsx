import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const AdminThumbnailPanel = () => {
  const [activeTab, setActiveTab] = useState('status');
  const [processorStatus, setProcessorStatus] = useState([]);
  const [queueStats, setQueueStats] = useState({});
  const [processingJobs, setProcessingJobs] = useState([]);
  const [errorLogs, setErrorLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [testingProcessor, setTestingProcessor] = useState(null);
  const [testingFull, setTestingFull] = useState(null);
  const [testResults, setTestResults] = useState(null);
  const [configPath, setConfigPath] = useState('');
  const [selectedProcessor, setSelectedProcessor] = useState('ghostscript');

  const token = localStorage.getItem('token');

  // Fetch processor status
  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE_URL}/admin/thumbnail/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setProcessorStatus(res.data.processors || []);
      setQueueStats(res.data.queue || {});
    } catch (err) {
      console.error('Failed to fetch status:', err);
    } finally {
      setLoading(false);
    }
  };

  // Run processor detection
  const runDetection = async () => {
    try {
      setLoading(true);
      const res = await axios.post(`${API_BASE_URL}/admin/thumbnail/detect`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setProcessorStatus(res.data.config || []);
      alert('Processor detection completed');
    } catch (err) {
      console.error('Detection failed:', err);
      alert(`Detection failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Test a single processor
  const testProcessor = async (processorName) => {
    try {
      setTestingProcessor(processorName);
      const res = await axios.post(
        `${API_BASE_URL}/admin/thumbnail/test-processor`,
        { processorName },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setTestResults(res.data);
      alert(`${processorName} test completed: ${res.data.testResult.status}`);
    } catch (err) {
      console.error('Test failed:', err);
      alert(`Test failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setTestingProcessor(null);
    }
  };

  // Test full processing pipeline
  const testFullProcessing = async (fileType) => {
    try {
      setTestingFull(fileType);
      const res = await axios.post(
        `${API_BASE_URL}/admin/thumbnail/test-full-processing`,
        { fileType },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setTestResults(res.data);
      alert(`Full processing test completed for ${fileType}`);
    } catch (err) {
      console.error('Full processing test failed:', err);
      alert(`Test failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setTestingFull(null);
    }
  };

  // Fetch processing jobs
  const fetchJobs = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE_URL}/admin/thumbnail/processing-jobs?limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setProcessingJobs(res.data.jobs || []);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch error logs
  const fetchErrorLogs = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE_URL}/admin/thumbnail/error-logs?limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setErrorLogs(res.data.errors || []);
    } catch (err) {
      console.error('Failed to fetch error logs:', err);
    } finally {
      setLoading(false);
    }
  };

  // Retry failed job
  const retryJob = async (jobId) => {
    try {
      await axios.post(
        `${API_BASE_URL}/admin/thumbnail/retry-job/${jobId}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      alert('Job queued for retry');
      fetchJobs();
    } catch (err) {
      console.error('Retry failed:', err);
      alert(`Retry failed: ${err.response?.data?.error || err.message}`);
    }
  };

  // Configure processor path
  const configureProcessor = async () => {
    if (!configPath) {
      alert('Please enter executable path');
      return;
    }

    try {
      await axios.post(
        `${API_BASE_URL}/admin/thumbnail/configure`,
        { processorName: selectedProcessor, executablePath: configPath },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      alert('Processor configured successfully');
      setConfigPath('');
      fetchStatus();
    } catch (err) {
      console.error('Configuration failed:', err);
      alert(`Configuration failed: ${err.response?.data?.error || err.message}`);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <h1>🎨 Thumbnail Processing System</h1>
      
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={() => setActiveTab('status')}
          style={{ 
            padding: '10px 20px', 
            marginRight: '10px', 
            backgroundColor: activeTab === 'status' ? '#007bff' : '#ddd',
            color: activeTab === 'status' ? '#fff' : '#000',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Status & Config
        </button>
        <button 
          onClick={() => setActiveTab('jobs')}
          style={{ 
            padding: '10px 20px', 
            marginRight: '10px', 
            backgroundColor: activeTab === 'jobs' ? '#007bff' : '#ddd',
            color: activeTab === 'jobs' ? '#fff' : '#000',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Processing Jobs
        </button>
        <button 
          onClick={() => setActiveTab('errors')}
          style={{ 
            padding: '10px 20px', 
            backgroundColor: activeTab === 'errors' ? '#007bff' : '#ddd',
            color: activeTab === 'errors' ? '#fff' : '#000',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Error Logs
        </button>
      </div>

      {/* STATUS TAB */}
      {activeTab === 'status' && (
        <div>
          <h2>Processor Status</h2>
          
          <div style={{ marginBottom: '20px' }}>
            <button 
              onClick={runDetection}
              disabled={loading}
              style={{ padding: '10px 20px', marginRight: '10px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              {loading ? 'Detecting...' : 'Run Detection'}
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
            <thead style={{ backgroundColor: '#f5f5f5' }}>
              <tr>
                <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Processor</th>
                <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Status</th>
                <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Version</th>
                <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {processorStatus.map((proc) => (
                <tr key={proc.processor_name}>
                  <td style={{ padding: '10px', border: '1px solid #ddd' }}>{proc.processor_name}</td>
                  <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                    <span style={{
                      backgroundColor: proc.status === 'READY' ? '#d4edda' : proc.status === 'AVAILABLE' ? '#fff3cd' : '#f8d7da',
                      color: proc.status === 'READY' ? '#155724' : proc.status === 'AVAILABLE' ? '#856404' : '#721c24',
                      padding: '5px 10px',
                      borderRadius: '4px'
                    }}>
                      {proc.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px', border: '1px solid #ddd' }}>{proc.version || 'N/A'}</td>
                  <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                    <button 
                      onClick={() => testProcessor(proc.processor_name)}
                      disabled={testingProcessor === proc.processor_name}
                      style={{ padding: '5px 10px', backgroundColor: '#17a2b8', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                    >
                      {testingProcessor === proc.processor_name ? 'Testing...' : 'Test'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Queue Statistics</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
            <div style={{ padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
              <strong>Queued</strong><br />{queueStats.queued || 0}
            </div>
            <div style={{ padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
              <strong>Processing</strong><br />{queueStats.processing || 0}
            </div>
            <div style={{ padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
              <strong>Completed</strong><br />{queueStats.completed || 0}
            </div>
            <div style={{ padding: '15px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
              <strong>Failed</strong><br />{queueStats.failed || 0}
            </div>
          </div>

          <h3 style={{ marginTop: '20px' }}>Manual Configuration</h3>
          <div style={{ padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '4px', marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '10px' }}>
              Processor:
              <select 
                value={selectedProcessor} 
                onChange={(e) => setSelectedProcessor(e.target.value)}
                style={{ marginLeft: '10px', padding: '5px' }}
              >
                <option value="ghostscript">Ghostscript</option>
                <option value="imagemagick">ImageMagick</option>
                <option value="illustrator_worker">Adobe Illustrator</option>
                <option value="photoshop_worker">Adobe Photoshop</option>
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: '10px' }}>
              Executable Path:
              <input 
                type="text"
                value={configPath}
                onChange={(e) => setConfigPath(e.target.value)}
                placeholder="C:\\Program Files\\..."
                style={{ marginLeft: '10px', padding: '8px', width: '400px' }}
              />
            </label>
            <button 
              onClick={configureProcessor}
              style={{ padding: '10px 20px', backgroundColor: '#007bff', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              Configure
            </button>
          </div>

          <h3>Test Full Processing Pipeline</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
            <button 
              onClick={() => testFullProcessing('ai')}
              disabled={testingFull === 'ai'}
              style={{ padding: '10px 20px', backgroundColor: '#6f42c1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              {testingFull === 'ai' ? 'Testing AI...' : 'Test AI'}
            </button>
            <button 
              onClick={() => testFullProcessing('eps')}
              disabled={testingFull === 'eps'}
              style={{ padding: '10px 20px', backgroundColor: '#6f42c1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              {testingFull === 'eps' ? 'Testing EPS...' : 'Test EPS'}
            </button>
            <button 
              onClick={() => testFullProcessing('psd')}
              disabled={testingFull === 'psd'}
              style={{ padding: '10px 20px', backgroundColor: '#6f42c1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
            >
              {testingFull === 'psd' ? 'Testing PSD...' : 'Test PSD'}
            </button>
          </div>

          {testResults && (
            <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
              <h4>Test Results</h4>
              <pre style={{ overflow: 'auto', maxHeight: '400px' }}>
                {JSON.stringify(testResults, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* JOBS TAB */}
      {activeTab === 'jobs' && (
        <div>
          <h2>Processing Jobs</h2>
          <button 
            onClick={fetchJobs}
            disabled={loading}
            style={{ padding: '10px 20px', marginBottom: '20px', backgroundColor: '#17a2b8', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ backgroundColor: '#f5f5f5' }}>
              <tr>
                <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Asset ID</th>
                <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>File Type</th>
                <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Status</th>
                <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Created</th>
                <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {processingJobs.map((job) => (
                <tr key={job.id}>
                  <td style={{ padding: '10px', border: '1px solid #ddd' }}>{job.asset_id}</td>
                  <td style={{ padding: '10px', border: '1px solid #ddd' }}>{job.file_type}</td>
                  <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                    <span style={{
                      backgroundColor: 
                        job.status === 'COMPLETED' ? '#d4edda' :
                        job.status === 'FAILED' ? '#f8d7da' :
                        job.status === 'PROCESSING' ? '#cfe2ff' :
                        '#fff3cd',
                      color: 
                        job.status === 'COMPLETED' ? '#155724' :
                        job.status === 'FAILED' ? '#721c24' :
                        job.status === 'PROCESSING' ? '#084298' :
                        '#856404',
                      padding: '5px 10px',
                      borderRadius: '4px'
                    }}>
                      {job.status}
                    </span>
                  </td>
                  <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                    {new Date(job.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                    {job.status === 'FAILED' && (
                      <button 
                        onClick={() => retryJob(job.id)}
                        style={{ padding: '5px 10px', backgroundColor: '#fd7e14', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ERRORS TAB */}
      {activeTab === 'errors' && (
        <div>
          <h2>Error Logs</h2>
          <button 
            onClick={fetchErrorLogs}
            disabled={loading}
            style={{ padding: '10px 20px', marginBottom: '20px', backgroundColor: '#dc3545', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ backgroundColor: '#f5f5f5' }}>
              <tr>
                <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Asset ID</th>
                <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Processor</th>
                <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Error Type</th>
                <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Message</th>
                <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Stage</th>
                <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {errorLogs.map((log) => (
                <tr key={log.id}>
                  <td style={{ padding: '10px', border: '1px solid #ddd' }}>{log.asset_id}</td>
                  <td style={{ padding: '10px', border: '1px solid #ddd' }}>{log.processor}</td>
                  <td style={{ padding: '10px', border: '1px solid #ddd' }}>{log.error_type}</td>
                  <td style={{ padding: '10px', border: '1px solid #ddd', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {log.error_message}
                  </td>
                  <td style={{ padding: '10px', border: '1px solid #ddd' }}>{log.stage}</td>
                  <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminThumbnailPanel;
