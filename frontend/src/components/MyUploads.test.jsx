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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('places Not Submitted first and loads only draft uploads in that view', async () => {
    axios.get.mockResolvedValue({
      data: [
        { id: 20, title: 'Draft asset', status: 'draft', generated_thumbnail_status: 'READY' },
        { id: 21, title: 'Unsubmitted asset', status: 'not_submitted', generated_thumbnail_status: 'READY' },
        { id: 22, title: 'Pending asset', status: 'pending' },
      ],
    });

    render(<MyUploads />);

    const view = screen.getByLabelText(/view/i);
    expect(view.options[0]).toHaveValue('not-submitted');
    expect(view.options[0]).toHaveTextContent('Not Submitted');
    fireEvent.change(view, { target: { value: 'not-submitted' } });

    expect(await screen.findByText('Draft asset')).toBeInTheDocument();
    expect(screen.getByText('Unsubmitted asset')).toBeInTheDocument();
    expect(screen.queryByText('Pending asset')).not.toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining('/my-uploads?view=not-submitted'),
      expect.anything()
    );
  });

  it('requests the pending uploads view when the pending tab is selected', async () => {
    axios.get.mockResolvedValue({
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

  it('deletes a ready not-submitted asset using the contributor token', async () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    axios.get.mockResolvedValue({
      data: [
        {
          id: 12,
          title: 'Asset to delete',
          status: 'not_submitted',
          generated_thumbnail_status: 'READY',
        },
      ],
    });
    axios.delete.mockResolvedValueOnce({ data: 'Asset deleted successfully' });

    render(<MyUploads />);
    fireEvent.change(screen.getByLabelText(/view/i), { target: { value: 'not-submitted' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(
        'http://localhost:5000/images/12',
        { headers: { Authorization: 'Bearer test-token' } }
      );
    });
    await waitFor(() => {
      expect(screen.queryByText('Asset to delete')).not.toBeInTheDocument();
    });
  });

  it('submits a ready not-submitted asset for review', async () => {
    axios.get.mockResolvedValue({
      data: [{
        id: 18,
        title: 'Ready asset',
        category: 'Nature',
        collection: 'Photos',
        keywords: 'forest',
        extension: 'psd',
        status: 'not_submitted',
        generated_thumbnail_status: 'READY',
      }],
    });
    axios.post.mockResolvedValueOnce({ data: { status: 'pending' } });

    render(<MyUploads />);
    fireEvent.change(screen.getByLabelText(/view/i), { target: { value: 'not-submitted' } });
    expect(await screen.findByText('File Type: PSD')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        'http://localhost:5000/my-uploads/18/submit',
        {},
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
    expect(screen.queryByText('Ready asset')).not.toBeInTheDocument();
  });

  it('reuses the Single Upload metadata form to edit a not-submitted asset', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/my-uploads')) {
        return Promise.resolve({
          data: [{
            id: 19,
            title: 'Draft metadata',
            description: 'Existing description',
            category: 'Nature,Travel',
            collection: 'Photos',
            keywords: 'forest, landscape',
            type: 'commercial',
            extension: 'jpg',
            status: 'not_submitted',
            generated_thumbnail_status: 'READY',
          }],
        });
      }
      if (url.endsWith('/categories')) return Promise.resolve({ data: [] });
      if (url.endsWith('/collections')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });
    axios.put.mockResolvedValueOnce({
      data: { id: 19, status: 'not_submitted', title: 'Edited metadata' },
    });

    render(<MyUploads />);
    fireEvent.change(screen.getByLabelText(/view/i), { target: { value: 'not-submitted' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('heading', { name: 'Edit Not Submitted Asset' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Asset file')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: 'Edited metadata' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Metadata' }));

    await waitFor(() => {
      expect(axios.put).toHaveBeenCalledWith(
        'http://localhost:5000/images/19',
        expect.objectContaining({
          title: 'Edited metadata',
          category: 'Nature,Travel',
          collection: 'Photos',
          keywords: 'forest, landscape',
          description: 'Existing description',
          type: 'commercial',
        }),
        expect.objectContaining({ headers: expect.any(Object) })
      );
    });
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

  it('loads private thumbnails with authorization when legacy metadata is absent', async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:private-thumbnail');
    URL.revokeObjectURL = jest.fn();
    axios.get
      .mockResolvedValueOnce({
        data: [{ id: 8, title: 'Private thumbnail', status: 'pending' }],
      })
      .mockResolvedValueOnce({ data: new Blob(['thumbnail'], { type: 'image/webp' }) });

    const { unmount } = render(<MyUploads />);
    try {
      expect(await screen.findByAltText('Private thumbnail')).toHaveAttribute(
        'src',
        'blob:private-thumbnail'
      );
      expect(axios.get).toHaveBeenCalledWith(
        'http://localhost:5000/api/assets/8/thumbnail',
        expect.objectContaining({
          responseType: 'blob',
          headers: { Authorization: 'Bearer test-token' },
        })
      );
    } finally {
      unmount();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it('loads public thumbnails through the centralized endpoint', async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:public-thumbnail');
    URL.revokeObjectURL = jest.fn();
    axios.get
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [{ id: 10, title: 'Public thumbnail', status: 'approved' }],
      })
      .mockResolvedValueOnce({ data: new Blob(['thumbnail'], { type: 'image/webp' }) });

    const { unmount } = render(<MyUploads />);
    try {
      fireEvent.change(screen.getByLabelText(/view/i), { target: { value: 'approved' } });

      expect(await screen.findByAltText('Public thumbnail')).toHaveAttribute(
        'src',
        'blob:public-thumbnail'
      );
      expect(axios.get).toHaveBeenCalledWith(
        'http://localhost:5000/api/assets/10/thumbnail',
        expect.objectContaining({ responseType: 'blob' })
      );
    } finally {
      unmount();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it('falls back to the existing image-file route when a thumbnail is missing', async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:original-image');
    URL.revokeObjectURL = jest.fn();
    axios.get
      .mockResolvedValueOnce({
        data: [{
          id: 11,
          title: 'Source fallback',
          filename: 'contributor/2026/10/Pending/source.jpg',
          status: 'pending',
        }],
      })
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({ data: new Blob(['source'], { type: 'image/jpeg' }) });

    const { unmount } = render(<MyUploads />);
    try {
      expect(await screen.findByAltText('Source fallback')).toHaveAttribute(
        'src',
        'blob:original-image'
      );
      expect(axios.get).toHaveBeenLastCalledWith(
        'http://localhost:5000/api/files/contributor/2026/10/Pending/source.jpg',
        expect.objectContaining({
          responseType: 'blob',
          headers: { Authorization: 'Bearer test-token' },
        })
      );
    } finally {
      unmount();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it('uses the existing catalog preview for PSD uploads when the thumbnail is missing', async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:psd-preview');
    URL.revokeObjectURL = jest.fn();
    axios.get
      .mockResolvedValueOnce({
        data: [{
          id: 12,
          title: 'PSD upload',
          filename: 'contributor/2026/10/Pending/design.psd',
          status: 'pending',
        }],
      })
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({ data: new Blob(['preview'], { type: 'image/webp' }) });

    const { unmount } = render(<MyUploads />);
    try {
      expect(await screen.findByAltText('PSD upload')).toHaveAttribute('src', 'blob:psd-preview');
      expect(axios.get).toHaveBeenLastCalledWith(
        'http://localhost:5000/api/catalog-preview/12?quality=63',
        expect.objectContaining({
          responseType: 'blob',
          headers: { Authorization: 'Bearer test-token' },
        })
      );
    } finally {
      unmount();
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it('shows a thumbnail fallback if the centralized thumbnail fails to load', async () => {
    axios.get
      .mockResolvedValueOnce({
        data: [{ id: 9, title: 'Missing thumbnail', status: 'pending' }],
      })
      .mockRejectedValueOnce({ response: { status: 404 } });

    render(<MyUploads />);

    expect(await screen.findByRole('img', { name: 'Missing thumbnail thumbnail unavailable' }))
      .toHaveTextContent('Thumbnail unavailable');
  });
});
