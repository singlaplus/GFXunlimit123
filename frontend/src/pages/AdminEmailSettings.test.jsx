import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import AdminEmailSettings from './AdminEmailSettings';

jest.mock('axios');
jest.mock('../utils/authSession', () => ({
  getEffectiveAuthToken: () => 'test-token',
}));

describe('AdminEmailSettings', () => {
  beforeEach(() => {
    axios.get.mockResolvedValue({
      data: {
        provider: 'smtp',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_user: 'smtp-user',
        smtp_pass: '*****',
        smtp_secure: false,
        sender_email: 'noreply@example.com',
        sender_name: 'GFX Team',
        reply_to: 'support@example.com',
      },
    });
    axios.post.mockReset();
  });

  it('shows the backend SMTP detail when the test email fails', async () => {
    axios.post.mockRejectedValue({
      response: {
        data: {
          error: 'Failed to send test email',
          detail: 'SMTP authentication failed',
        },
      },
    });

    render(<AdminEmailSettings />);

    const input = await screen.findByPlaceholderText('recipient@example.com');
    fireEvent.change(input, { target: { value: 'admin@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send test/i }));

    await waitFor(() => {
      expect(screen.getByText('Test failed: SMTP authentication failed')).toBeInTheDocument();
    });
  });
});
