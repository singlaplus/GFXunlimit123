import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MyUploads from './MyUploads';
import axios from 'axios';

jest.mock('axios');
jest.mock('react-toastify', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

describe('MyUploads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('token', 'test-token');
  });

  it('requests the pending uploads view when the pending tab is selected', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          id: 1,
          title: 'Pending asset',
          category: 'Nature',
          keywords: 'forest',
          likes: 0,
          views: 0,
          downloads: 0,
          status: 'pending',
          created_at: '2026-07-20T00:00:00.000Z',
        },
      ],
    });

    render(<MyUploads />);

    fireEvent.change(screen.getByLabelText(/view/i), {
      target: { value: 'pending' },
    });

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/my-uploads?view=pending'),
        expect.anything()
      );
    });

    expect(await screen.findByText('Pending asset')).toBeInTheDocument();
  });

  it('requests the approved view without the old stats fields', async () => {
    axios.get.mockResolvedValueOnce({ data: [] });

    render(<MyUploads />);

    fireEvent.change(screen.getByLabelText(/view/i), {
      target: { value: 'approved' },
    });

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/my-uploads?view=approved'),
        expect.anything()
      );
    });

    expect(screen.getByText('No uploads match this view yet.')).toBeInTheDocument();
    expect(screen.queryByText(/❤️/)).not.toBeInTheDocument();
    expect(screen.queryByText(/👁/)).not.toBeInTheDocument();
  });


  it('shows edit controls for portfolio assets and hides the days-left label', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          id: 4,
          title: 'Portfolio asset',
          description: 'Portfolio description',
          collection: 'Nature',
          type: 'image',
          category: 'Nature',
          status: 'approved',
          created_at: '2026-07-24T00:00:00.000Z',
          updated_at: '2026-07-25T00:00:00.000Z',
        },
      ],
    });

    render(<MyUploads />);

    fireEvent.change(screen.getByLabelText(/view/i), {
      target: { value: 'portfolio' },
    });

    await waitFor(() => {
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/my-uploads?view=portfolio'),
        expect.anything()
      );
    });

    expect(screen.queryByText(/days left/i)).not.toBeInTheDocument();
  });

  it('ignores stale responses so the latest tab stays visible', async () => {
    let resolvePending;
    let resolveApproved;

    const pendingPromise = new Promise((resolve) => {
      resolvePending = resolve;
    });
    const approvedPromise = new Promise((resolve) => {
      resolveApproved = resolve;
    });

    axios.get
      .mockImplementationOnce(() => pendingPromise)
      .mockImplementationOnce(() => approvedPromise);

    render(<MyUploads />);

    fireEvent.change(screen.getByLabelText(/view/i), {
      target: { value: 'approved' },
    });

    resolvePending({
      data: [
        {
          id: 1,
          title: 'Pending asset',
          category: 'Nature',
          keywords: 'forest',
          likes: 0,
          views: 0,
          downloads: 0,
          status: 'pending',
          created_at: '2026-07-20T00:00:00.000Z',
        },
      ],
    });

    resolveApproved({
      data: [
        {
          id: 2,
          title: 'Approved asset',
          category: 'Nature',
          keywords: 'forest',
          likes: 0,
          views: 0,
          downloads: 0,
          status: 'approved',
          created_at: '2026-07-24T00:00:00.000Z',
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Approved asset')).toBeInTheDocument();
    });
  });
});
