import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import AdminEmailTemplates from './AdminEmailTemplates';

jest.mock('axios');

describe('AdminEmailTemplates', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'test-token');
    window.confirm = jest.fn(() => true);

    axios.get.mockImplementation((url) => {
      if (url.includes('/admin/email/templates')) {
        return Promise.resolve({
          data: [{
            id: 7,
            name: 'Welcome Campaign',
            subject: 'Hello there',
            body: '<div><h1>Welcome</h1><p>Body copy</p><img src="/api/files/website/email template/sample.png" /></div>',
            variables: []
          }]
        });
      }
      return Promise.resolve({ data: [] });
    });

    axios.post.mockResolvedValue({ data: { ok: true } });
    axios.delete.mockResolvedValue({ data: { ok: true } });
  });

  it('loads a saved template for editing and deletes it through the admin flow', async () => {
    render(<AdminEmailTemplates />);

    expect(await screen.findByText('Welcome Campaign')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /edit/i }));

    expect(screen.getByDisplayValue('Welcome Campaign')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hello there')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Welcome Campaign'), { target: { value: 'Updated Campaign' } });
    fireEvent.change(screen.getByDisplayValue('Hello there'), { target: { value: 'Updated Subject' } });

    fireEvent.click(screen.getByRole('button', { name: /delete template/i }));

    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining('/admin/email/templates/7'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-token' }
        })
      );
    });
  });

  it('exposes the admin template controls for type, enable state, preview, and restore defaults', async () => {
    render(<AdminEmailTemplates />);

    fireEvent.click(await screen.findByRole('button', { name: /edit template/i }));

    expect(screen.getByLabelText(/template type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/enabled/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore default template/i })).toBeInTheDocument();
  });

  it('shows template load failures and retries with a GET', async () => {
    axios.get.mockRejectedValueOnce(new Error('Unavailable'));
    render(<AdminEmailTemplates />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load email templates.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    axios.get.mockResolvedValueOnce({ data: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('No saved templates yet.')).toBeInTheDocument();
    });
    expect(axios.get).toHaveBeenCalledTimes(2);
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
    expect(axios.delete).not.toHaveBeenCalled();
  });

  it('does not show an empty template state before the initial GET succeeds', async () => {
    let resolveTemplates;
    axios.get.mockReturnValueOnce(new Promise((resolve) => {
      resolveTemplates = resolve;
    }));
    render(<AdminEmailTemplates />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading email templates...');
    expect(screen.queryByText('No saved templates yet.')).not.toBeInTheDocument();

    await act(async () => {
      resolveTemplates({ data: [] });
    });
    expect(screen.getByText('No saved templates yet.')).toBeInTheDocument();
  });
});
