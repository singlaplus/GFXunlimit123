import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import axios from 'axios';
import TaxMailSMTPSettings from './TaxMailSMTPSettings';

jest.mock('axios');

describe('TaxMailSMTPSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('opens a recipient dialog and sends a real test email to the entered address', async () => {
    axios.post.mockResolvedValue({ data: { ok: true } });

    render(<TaxMailSMTPSettings isDarkMode={false} getEffectiveAuthToken={() => 'demo-token'} />);

    fireEvent.change(screen.getByLabelText(/sender name/i), { target: { value: 'GFXunlimit Tax Forms' } });
    fireEvent.change(screen.getByLabelText(/sender email/i), { target: { value: 'taxforms@gfxunlimit.com' } });
    fireEvent.change(screen.getByLabelText(/smtp host/i), { target: { value: 'smtp.hostinger.com' } });
    fireEvent.change(screen.getByLabelText(/smtp port/i), { target: { value: '465' } });
    fireEvent.change(screen.getByLabelText(/smtp username/i), { target: { value: 'taxforms@gfxunlimit.com' } });
    fireEvent.change(screen.getByLabelText(/smtp password/i), { target: { value: 'secret' } });

    fireEvent.click(screen.getByRole('button', { name: /send test mail/i }));

    const dialog = await screen.findByRole('dialog', { name: /send test mail/i });
    fireEvent.change(within(dialog).getByLabelText(/recipient email/i), {
      target: { value: 'aanavcreationsplus@gmail.com' }
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /^send test mail$/i }));

    await waitFor(() => {
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/admin/email/tax-mail/send-test'),
        expect.objectContaining({
          to: 'aanavcreationsplus@gmail.com',
          subject: 'Tax form SMTP test email',
          body: expect.stringContaining('Tax form SMTP test email')
        }),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer demo-token' })
        })
      );
    });
  });
});
